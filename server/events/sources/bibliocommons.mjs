import {
  canonicalHttpsUrl,
  cleanText,
  costDetails,
  formatEventLabels,
  inferCategories,
  nextDateKey,
  sourceCheckLabel,
  truncate,
} from "../normalize.mjs";
import {
  xmlAttribute,
  xmlBlock,
  xmlItems,
  xmlTag,
  xmlTags,
} from "../xml.mjs";

export const BIBLIOCOMMONS_LIBRARIES = [
  {
    id: "paloalto",
    name: "Palo Alto City Library",
    platform: "Palo Alto Library",
  },
];

const audiencePattern =
  /\b(adult|bab|birth|famil|grade|kid|preschool|senior|teen|toddler|tween|youth)\b/i;

function boolTag(item, tagName) {
  return cleanText(xmlTag(item, tagName)).toLowerCase() === "true";
}

function locationDetails(item, isVirtual, library) {
  if (isVirtual) {
    return {
      venue: `${library.name} online`,
      address: "Online",
      neighborhood: "Online",
      latitude: null,
      longitude: null,
    };
  }
  const location = xmlBlock(item, "bc:location");
  const venue = cleanText(xmlTag(location, "bc:name")) || library.name;
  const city = cleanText(xmlTag(location, "bc:city"));
  const state = cleanText(xmlTag(location, "bc:state"));
  const street = [
    cleanText(xmlTag(location, "bc:number")),
    cleanText(xmlTag(location, "bc:street")),
  ]
    .filter(Boolean)
    .join(" ");
  const zip = cleanText(xmlTag(location, "bc:zip"));
  return {
    venue,
    address:
      [street, city, state, zip].filter(Boolean).join(", ") ||
      `${city || library.name}, CA`,
    neighborhood: city || library.name,
    latitude: Number(xmlTag(location, "bc:latitude")) || null,
    longitude: Number(xmlTag(location, "bc:longitude")) || null,
  };
}

export function parseBibliocommonsRss(
  xml,
  library,
  { checkedAt = new Date().toISOString() } = {},
) {
  const sourceDataAt = xmlTag(xml, "lastBuildDate") || checkedAt;
  return xmlItems(xml)
    .map((item) => {
      const title = cleanText(xmlTag(item, "title"));
      const sourceHref = canonicalHttpsUrl(xmlTag(item, "link"));
      const startAt = cleanText(xmlTag(item, "bc:start_date"));
      const endAt = cleanText(xmlTag(item, "bc:end_date"));
      if (
        !title ||
        !sourceHref ||
        !Number.isFinite(Date.parse(startAt)) ||
        !Number.isFinite(Date.parse(endAt)) ||
        boolTag(item, "bc:is_cancelled")
      ) {
        return null;
      }
      const registration = xmlBlock(item, "bc:registration_info");
      const registrationRequired =
        cleanText(xmlTag(registration, "bc:is_required")).toLowerCase() ===
        "true";
      const registrationFull =
        cleanText(xmlTag(registration, "bc:is_full")).toLowerCase() ===
        "true";
      if (registrationFull) return null;

      const categoriesFromFeed = xmlTags(item, "category").map(cleanText);
      const audienceTags = categoriesFromFeed.filter((value) =>
        audiencePattern.test(value),
      );
      const description = truncate(xmlTag(item, "description"), 420);
      const categories = inferCategories(
        title,
        description,
        categoriesFromFeed,
      );
      const isVirtual = boolTag(item, "bc:is_virtual");
      const location = locationDetails(item, isVirtual, library);
      const { cost, costLabel } = costDetails({ description });
      const externalId =
        new URL(sourceHref).pathname.split("/").filter(Boolean).at(-1) ||
        sourceHref;
      const unknowns = [
        "Feed audience categories describe the intended audience, not a confirmed admission policy.",
      ];
      if (cost === null) {
        unknowns.push("The RSS record does not publish a price.");
      }

      return {
        id: `bibliocommons-${library.id}-${externalId}`,
        title,
        shortTitle: truncate(title, 62),
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        ...formatEventLabels(startAt, endAt),
        ...location,
        categories,
        tags: [
          ...new Set([...categoriesFromFeed, library.name]),
        ].slice(0, 14),
        ageTags: audienceTags,
        audienceLabel: audienceTags.length
          ? `${audienceTags.slice(0, 2).join(" · ")} · source categories`
          : "Audience not published",
        cost,
        costLabel,
        eligibility: "unknown",
        eligibilityLabel: "Age policy not independently confirmed",
        format: isVirtual ? "Online" : "In person",
        registration: registrationRequired
          ? "Registration required"
          : "No registration required",
        registrationStatus: registrationRequired ? "required" : "open",
        source: library.name,
        sourceId: externalId,
        sourcePlatform: library.platform,
        sourceHref,
        sourceDataset: `${library.name} · official event RSS`,
        sourceDatasetHref: `https://${library.id}.bibliocommons.com/events`,
        sourceType: "rss",
        sourceDataAt,
        sourceCheckedAt: checkedAt,
        checked: sourceCheckLabel(checkedAt),
        verificationStatus: "verified",
        eventStatus: "scheduled",
        image:
          canonicalHttpsUrl(xmlAttribute(item, "enclosure", "url")) ||
          "/event-placeholder.svg",
        imageAlt: `Source image for ${title}.`,
        matchLabel: `${location.neighborhood} · library event`,
        matchReason: `A current public event from ${library.name}’s official RSS feed.`,
        description:
          description || `See the library event page for details about ${title}.`,
        confidence:
          "Schedule, registration state, venue, audience categories, and canonical link came from the library’s official RSS feed.",
        unknowns,
      };
    })
    .filter(Boolean);
}

function rangeMidpoint(startDateKey, endDateKey) {
  const start = Date.parse(`${startDateKey}T12:00:00Z`);
  const end = Date.parse(`${endDateKey}T12:00:00Z`);
  return new Date(start + Math.floor((end - start) / 2))
    .toISOString()
    .slice(0, 10);
}

async function fetchRange({
  library,
  startDateKey,
  endDateKey,
  fetchImpl,
  signal,
  checkedAt,
}) {
  const url = new URL(
    `https://gateway.bibliocommons.com/v2/libraries/${library.id}/rss/events`,
  );
  url.searchParams.set("startDate", startDateKey);
  url.searchParams.set("endDate", endDateKey);
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
      "User-Agent":
        "FindrCatalogSync/1.0 (+https://github.com/Srikamarthapu/Findr)",
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `${library.name} RSS request failed with HTTP ${response.status}.`,
    );
  }
  const xml = await response.text();
  const events = parseBibliocommonsRss(xml, library, { checkedAt });

  if (events.length >= 25 && startDateKey < endDateKey) {
    const midpoint = rangeMidpoint(startDateKey, endDateKey);
    const nextDay = nextDateKey(midpoint);
    const [left, right] = await Promise.all([
      fetchRange({
        library,
        startDateKey,
        endDateKey: midpoint,
        fetchImpl,
        signal,
        checkedAt,
      }),
      fetchRange({
        library,
        startDateKey: nextDay,
        endDateKey,
        fetchImpl,
        signal,
        checkedAt,
      }),
    ]);
    return [...left, ...right];
  }

  return events;
}

export async function fetchBibliocommonsEvents({
  library,
  now = new Date(),
  horizonDays = 21,
  fetchImpl = fetch,
  signal,
  checkedAt = new Date().toISOString(),
} = {}) {
  const startDateKey = now.toISOString().slice(0, 10);
  const endDateKey = new Date(
    now.getTime() + horizonDays * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const events = await fetchRange({
    library,
    startDateKey,
    endDateKey,
    fetchImpl,
    signal,
    checkedAt,
  });
  const horizon = now.getTime() + horizonDays * 86_400_000;
  return events.filter(
    (event) =>
      Date.parse(event.endAt) > now.getTime() &&
      Date.parse(event.startAt) <= horizon,
  );
}
