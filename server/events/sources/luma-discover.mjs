import {
  canonicalHttpsUrl,
  cleanText,
  formatEventLabels,
  inferCategories,
  localDateTimeToIso,
  sourceCheckLabel,
  truncate,
} from "../normalize.mjs";
import { structuredEventsFromHtml } from "../pipeline.mjs";

export const LUMA_SF_DISCOVER_PAGE = "https://luma.com/sf";
export const LUMA_SF_ICAL_URL =
  "https://api.luma.com/ics/get?entity=discover&id=discplace-BDj7GNbGlsF7Cka";

const HOUR_MS = 60 * 60 * 1000;
const unavailableOfferPattern =
  /schema\.org\/(?:SoldOut|OutOfStock|Discontinued)$/i;
const techCommunityPattern =
  /\b(ai|artificial intelligence|agentic|agents?|api|builder|coding|compute|crypto|data|demo day|developer|devtools?|engineering|founders?|fundraising|gtm|hackathon|investors?|llms?|machine learning|mcp|multimodal|pitch|product launch|research|robotics?|saas|startup|tech|venture|vc|yc)\b/i;

function unfoldIcal(value) {
  return String(value).replace(/\r?\n[ \t]/g, "");
}

function unescapeIcalText(value = "") {
  return String(value)
    .replace(/\\[nN]/g, "\n")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
}

function propertyName(line) {
  return line.slice(0, line.indexOf(":")).split(";")[0].toUpperCase();
}

function propertyValue(line) {
  return unescapeIcalText(line.slice(line.indexOf(":") + 1));
}

function firstProperty(lines, name) {
  const normalized = name.toUpperCase();
  const line = lines.find(
    (candidate) =>
      candidate.includes(":") && propertyName(candidate) === normalized,
  );
  return line ? propertyValue(line) : "";
}

function organizerName(lines) {
  const line = lines.find(
    (candidate) =>
      candidate.includes(":") && propertyName(candidate) === "ORGANIZER",
  );
  if (!line) return "";
  const metadata = line.slice(0, line.indexOf(":"));
  const match = metadata.match(/(?:^|;)CN=(?:"([^"]+)"|([^;]+))/i);
  return cleanText(match?.[1] || match?.[2] || "");
}

function parseIcalDate(line) {
  if (!line) return null;
  const metadata = line.slice(0, line.indexOf(":"));
  const value = line.slice(line.indexOf(":") + 1).trim();
  const allDay = /(?:^|;)VALUE=DATE(?:;|$)/i.test(metadata) ||
    /^\d{8}$/.test(value);

  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const match = value.match(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    );
    return {
      iso: new Date(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        ),
      ).toISOString(),
      allDay: false,
    };
  }

  const localMatch = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/,
  );
  if (!localMatch) return null;
  const dateKey = `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}`;
  const time = localMatch[4]
    ? `${localMatch[4]}:${localMatch[5]}:${localMatch[6]}`
    : "00:00:00";
  return {
    iso: localDateTimeToIso(dateKey, time),
    allDay,
  };
}

function directLumaUrl(description) {
  const match = String(description).match(
    /Get up-to-date information at:\s*(https:\/\/luma\.com\/[^\s]+)/i,
  );
  return canonicalHttpsUrl(match?.[1]);
}

function addressFromDescription(description) {
  const match = String(description).match(
    /Address:\s*\n([\s\S]*?)(?:\n\s*\n|$)/i,
  );
  const lines = String(match?.[1] || "")
    .split(/\n/)
    .map(cleanText)
    .filter(Boolean)
    .filter((line) => !/^united states$/i.test(line));
  if (!lines.length || lines.some((line) => /check event page/i.test(line))) {
    return null;
  }
  return lines.join(", ");
}

function canonicalTopics(...values) {
  const text = cleanText(values.flat().filter(Boolean).join(" "));
  const topics = new Set();
  if (
    /\b(ai|artificial intelligence|agentic|agents?|llms?|machine learning|mcp|model|multimodal)\b/i.test(
      text,
    )
  ) {
    topics.add("AI");
  }
  if (
    /\b(founders?|fundraising|gtm|investors?|pitch|saas|startup|venture|vc|yc)\b/i.test(
      text,
    )
  ) {
    topics.add("Startups");
  }
  if (/\bhack(?:athon|s)?\b/i.test(text)) topics.add("Hackathons");
  if (/\b(demo day|demos?|showcase|show and tell)\b/i.test(text)) {
    topics.add("Demos");
  }
  if (/\b(research|researchers?|paper|academic|phd|postdoc)\b/i.test(text)) {
    topics.add("Research");
  }
  if (/\b(networking|meetup|community|coffee|social)\b/i.test(text)) {
    topics.add("Networking");
  }
  if (
    /\b(api|builder|coding|developer|devtools?|engineering|hardware|robotics?)\b/i.test(
      text,
    )
  ) {
    topics.add("Developer");
  }
  return [...topics];
}

function roleAudience(...values) {
  const text = cleanText(values.flat().filter(Boolean).join(" "));
  const roles = [
    ["Founders", /\bfounders?\b/i],
    ["Builders", /\bbuilders?\b/i],
    ["Developers", /\bdevelopers?|engineers?\b/i],
    ["Researchers", /\bresearchers?|phds?|postdocs?\b/i],
    ["Investors", /\binvestors?|vcs?\b/i],
    ["Students", /\bstudents?\b/i],
  ]
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
  return roles.slice(0, 3);
}

function preliminaryLocation(description, location) {
  const address = addressFromDescription(description);
  const hidden = /^https:\/\/luma\.com\/event\//i.test(location);
  const published = hidden ? null : cleanText(location);
  const display = address || published;
  const online = /\b(online|remote|zoom)\b/i.test(
    `${display || ""} ${description}`,
  );
  return {
    format: online ? "Online" : "In person",
    venue: online ? "Online" : display || "Venue shared by organizer",
    address: online ? "Online" : display || "San Francisco Bay Area",
    neighborhood: online ? "Online" : "San Francisco Bay Area",
  };
}

function eventLines(block) {
  return unfoldIcal(block)
    .split(/\r?\n/)
    .filter(Boolean);
}

export function parseLumaDiscoverIcal(
  ical,
  { checkedAt = new Date().toISOString() } = {},
) {
  return [...String(ical).matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)]
    .map((match) => {
      const lines = eventLines(match[1]);
      const startLine = lines.find(
        (line) => line.includes(":") && propertyName(line) === "DTSTART",
      );
      const endLine = lines.find(
        (line) => line.includes(":") && propertyName(line) === "DTEND",
      );
      const start = parseIcalDate(startLine);
      const parsedEnd = parseIcalDate(endLine);
      const title = cleanText(firstProperty(lines, "SUMMARY"));
      const description = firstProperty(lines, "DESCRIPTION");
      const sourceHref = directLumaUrl(description);
      const uid = cleanText(firstProperty(lines, "UID"));
      const status = cleanText(firstProperty(lines, "STATUS")).toUpperCase();
      if (
        !title ||
        !sourceHref ||
        !uid ||
        !start ||
        status === "CANCELLED"
      ) {
        return null;
      }

      const endAt =
        parsedEnd?.iso ||
        new Date(Date.parse(start.iso) + 2 * HOUR_MS).toISOString();
      if (Date.parse(endAt) <= Date.parse(start.iso)) return null;
      const organizer = organizerName(lines);
      const locationText = firstProperty(lines, "LOCATION");
      const location = preliminaryLocation(description, locationText);
      const geo = firstProperty(lines, "GEO")
        .split(";")
        .map(Number);
      const topics = canonicalTopics(title, description, organizer);
      const categories = inferCategories(
        title,
        description,
        organizer,
        topics,
      );
      const sourceDataAt =
        parseIcalDate(
          lines.find(
            (line) =>
              line.includes(":") && propertyName(line) === "DTSTAMP",
          ),
        )?.iso || checkedAt;
      const audience = roleAudience(title, description);
      const externalId = uid.split("@")[0] || uid;

      return {
        id: `luma-discover-${externalId.replace(/[^a-z0-9_-]+/gi, "-")}`,
        title,
        shortTitle: truncate(title, 62),
        startAt: start.iso,
        endAt,
        ...formatEventLabels(start.iso, endAt, {
          allDay: start.allDay,
        }),
        ...location,
        latitude: Number.isFinite(geo[0]) ? geo[0] : null,
        longitude: Number.isFinite(geo[1]) ? geo[1] : null,
        categories,
        tags: [...new Set([...topics, organizer].filter(Boolean))].slice(
          0,
          12,
        ),
        ageTags: [],
        audienceLabel: audience.length
          ? `${audience.join(" · ")} · source description`
          : "Audience not published",
        cost: null,
        costLabel: "Cost not published",
        eligibility: "unknown",
        eligibilityLabel: "Age policy not published",
        format: location.format,
        registration: "Check organizer page",
        registrationStatus: "unknown",
        source: organizer
          ? `Luma Discover · ${organizer}`
          : "Luma Discover · San Francisco",
        sourceId: externalId,
        sourcePlatform: "Luma",
        sourceHref,
        sourceDataset: "Luma San Francisco · official city iCal",
        sourceDatasetHref: LUMA_SF_DISCOVER_PAGE,
        sourceType: "ical",
        sourceDataAt,
        sourceCheckedAt: checkedAt,
        checked: sourceCheckLabel(checkedAt),
        verificationStatus: "verified",
        eventStatus: "scheduled",
        image: "/event-placeholder.svg",
        imageAlt: `Findr editorial placeholder for ${title}.`,
        matchLabel: "Luma Discover · Bay Area tech community",
        matchReason:
          "A current AI, startup, builder, or research event discovered through Luma’s official San Francisco city calendar subscription.",
        description:
          truncate(
            description.replace(
              /Get up-to-date information at:[^\n]+\n*/i,
              "",
            ),
            360,
          ) || `See the organizer page for details about ${title}.`,
        confidence:
          "Schedule, organizer, coordinates, and canonical link came from Luma’s official city iCal feed; Findr rechecks the structured event page before publishing.",
        unknowns: [
          "Age and admission policies remain organizer-controlled; confirm them on the event page.",
          "The city calendar feed does not publish a reliable ticket price or capacity state.",
        ],
      };
    })
    .filter(Boolean);
}

export function isLumaTechCommunityEvent(event) {
  return techCommunityPattern.test(
    cleanText(
      [
        event.title,
        event.description,
        event.tags?.join(" "),
        event.categories?.join(" "),
      ].join(" "),
    ),
  );
}

function structuredAddress(location) {
  const address = location?.address;
  if (typeof address === "string") return cleanText(address);
  if (!address || typeof address !== "object") return "";
  return [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(", ");
}

function structuredLocation(record, fallback) {
  const location = Array.isArray(record.location)
    ? record.location[0]
    : record.location;
  const virtual =
    location?.["@type"] === "VirtualLocation" ||
    record.eventAttendanceMode ===
      "https://schema.org/OnlineEventAttendanceMode";
  if (virtual) {
    return {
      format: "Online",
      venue: "Online",
      address: "Online",
      neighborhood: "Online",
      latitude: null,
      longitude: null,
    };
  }

  const address = structuredAddress(location);
  const venue = cleanText(location?.name) || fallback.venue;
  const locality = cleanText(location?.address?.addressLocality);
  return {
    format: "In person",
    venue,
    address: address || fallback.address,
    neighborhood: locality || fallback.neighborhood,
    latitude:
      Number(location?.geo?.latitude ?? location?.latitude) ||
      fallback.latitude,
    longitude:
      Number(location?.geo?.longitude ?? location?.longitude) ||
      fallback.longitude,
  };
}

function offerDetails(record) {
  const offers = [record.offers || []].flat().filter(Boolean);
  const available = offers.filter(
    (offer) => !unavailableOfferPattern.test(String(offer.availability || "")),
  );
  if (offers.length && !available.length) return null;
  const prices = available
    .map((offer) => Number(offer.price))
    .filter(Number.isFinite);
  const cost = prices.length ? Math.min(...prices) : null;
  return {
    cost,
    costLabel:
      cost === 0
        ? "Free"
        : cost === null
          ? "Cost not published"
          : `${prices.length > 1 ? "From " : ""}$${Number.isInteger(cost) ? cost : cost.toFixed(2)}`,
    registration: available.length
      ? "Registration available"
      : "Check organizer page",
    registrationStatus: available.length ? "open" : "unknown",
  };
}

async function fetchStructuredEvent(
  event,
  { fetchImpl, checkedAt, signal, now },
) {
  const response = await fetchImpl(event.sourceHref, {
    headers: {
      Accept: "text/html",
      "User-Agent":
        "FindrCatalogSync/1.0 (+https://github.com/Srikamarthapu/Findr)",
    },
    signal,
  });
  if (!response.ok) return null;
  const record = structuredEventsFromHtml(await response.text()).find(
    (candidate) =>
      candidate.eventStatus === "https://schema.org/EventScheduled" &&
      Date.parse(candidate.startDate) === Date.parse(event.startAt),
  );
  if (!record || Date.parse(record.endDate) <= now.getTime()) return null;
  const offers = offerDetails(record);
  if (!offers) return null;
  const title = cleanText(record.name) || event.title;
  const description = truncate(record.description, 360) || event.description;
  const organizerRecords = [record.organizer || []].flat().filter(Boolean);
  const organizers = [
    ...new Set(organizerRecords.map((item) => cleanText(item.name)).filter(Boolean)),
  ];
  const topics = canonicalTopics(title, description, organizers);
  const audience = roleAudience(title, description);
  const startAt = new Date(record.startDate).toISOString();
  const endAt = new Date(record.endDate).toISOString();

  return {
    ...event,
    title,
    shortTitle: truncate(title, 62),
    startAt,
    endAt,
    ...formatEventLabels(startAt, endAt),
    ...structuredLocation(record, event),
    categories: inferCategories(title, description, organizers, topics),
    tags: [...new Set([...topics, ...organizers])].slice(0, 12),
    audienceLabel: audience.length
      ? `${audience.join(" · ")} · source description`
      : "Audience not published",
    ...offers,
    source:
      organizers.length > 0
        ? `Luma Discover · ${organizers.slice(0, 2).join(" & ")}`
        : event.source,
    sourceCheckedAt: checkedAt,
    checked: sourceCheckLabel(checkedAt),
    description,
    confidence:
      "Discovered through Luma’s official San Francisco city iCal; schedule, organizer, venue, ticket availability, price, and canonical link were rechecked against structured event data.",
    unknowns: [
      "Age and admission policies remain organizer-controlled; confirm them on the event page.",
      ...(offers.cost === null
        ? ["The structured event page does not publish an exact ticket price."]
        : []),
    ],
  };
}

export async function verifyLumaDiscoverEvents(
  events,
  {
    fetchImpl = fetch,
    checkedAt = new Date().toISOString(),
    now = new Date(),
    signal,
    concurrency = 6,
  } = {},
) {
  const verified = [];
  let cursor = 0;

  async function worker() {
    while (cursor < events.length) {
      const event = events[cursor];
      cursor += 1;
      try {
        const refreshed = await fetchStructuredEvent(event, {
          fetchImpl,
          checkedAt,
          signal,
          now,
        });
        if (refreshed) verified.push(refreshed);
      } catch {
        // A single organizer page should not fail the entire city feed.
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, events.length) },
      () => worker(),
    ),
  );
  return verified.sort(
    (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt),
  );
}

export async function fetchLumaDiscoverEvents({
  now = new Date(),
  horizonDays = 35,
  fetchImpl = fetch,
  signal,
  checkedAt = new Date().toISOString(),
  candidateLimit = 32,
} = {}) {
  const response = await fetchImpl(LUMA_SF_ICAL_URL, {
    headers: {
      Accept: "text/calendar",
      "User-Agent":
        "FindrCatalogSync/1.0 (+https://github.com/Srikamarthapu/Findr)",
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Luma city iCal request failed with HTTP ${response.status}.`);
  }
  const horizon = now.getTime() + horizonDays * 86_400_000;
  const candidates = parseLumaDiscoverIcal(await response.text(), {
    checkedAt,
  })
    .filter((event) => Date.parse(event.endAt) > now.getTime())
    .filter((event) => Date.parse(event.startAt) <= horizon)
    .filter(isLumaTechCommunityEvent)
    .sort(
      (a, b) =>
        Date.parse(a.startAt) - Date.parse(b.startAt) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, candidateLimit);

  const verified = await verifyLumaDiscoverEvents(candidates, {
    fetchImpl,
    checkedAt,
    now,
    signal,
  });
  if (
    candidates.length >= 8 &&
    verified.length < Math.min(5, Math.ceil(candidates.length * 0.25))
  ) {
    throw new Error(
      `Luma structured recheck returned only ${verified.length}/${candidates.length} usable events.`,
    );
  }
  return verified;
}
