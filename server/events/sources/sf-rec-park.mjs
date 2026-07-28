import {
  canonicalHttpsUrl,
  cleanText,
  costDetails,
  formatEventLabels,
  inferCategories,
  localDateTimeToIso,
  slugify,
  sourceCheckLabel,
  truncate,
} from "../normalize.mjs";
import {
  xmlAttribute,
  xmlItems,
  xmlTag,
} from "../xml.mjs";

export const SF_REC_PARK_RSS_URL =
  "https://www.sfrecpark.org/RSSFeed.aspx?CID=All-calendar.xml&ModID=58";
export const SF_REC_PARK_RSS_DIRECTORY =
  "https://www.sfrecpark.org/rss.aspx";

function parseClock(value) {
  const match = cleanText(value).match(
    /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i,
  );
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const suffix = match[3].toUpperCase();
  if (suffix === "PM" && hour !== 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function parseFeedDate(value) {
  const parsed = new Date(cleanText(value));
  if (!Number.isFinite(parsed.getTime())) return null;
  return [
    parsed.getUTCFullYear(),
    String(parsed.getUTCMonth() + 1).padStart(2, "0"),
    String(parsed.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function descriptionParts(rawDescription) {
  const withLines = String(rawDescription)
    .replace(/&lt;br\s*\/?&gt;/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const text = cleanText(withLines.replace(/\n/g, " | "));
  const locationMatch = text.match(
    /Location:\s*(.*?)\s*(?:\|\s*)?Description:/i,
  );
  const descriptionMatch = text.match(/Description:\s*(.*)$/i);
  return {
    address: cleanText(locationMatch?.[1] || ""),
    description: cleanText(descriptionMatch?.[1] || text),
  };
}

function venueFor(title, address) {
  if (/bandshell/i.test(title)) return "Golden Gate Bandshell";
  if (/union square/i.test(title) || /post and stockton/i.test(address)) {
    return "Union Square";
  }
  if (/jerry garcia/i.test(title)) return "Jerry Garcia Amphitheater";
  return "SF Recreation & Parks";
}

export function parseSfRecParkRss(
  xml,
  { checkedAt = new Date().toISOString() } = {},
) {
  const sourceDataAt = xmlTag(xml, "lastBuildDate") || checkedAt;

  return xmlItems(xml)
    .map((item) => {
      const title = cleanText(xmlTag(item, "title"));
      const sourceHref = canonicalHttpsUrl(xmlTag(item, "link"));
      const eventDate = parseFeedDate(
        xmlTag(item, "calendarEvent:EventDates"),
      );
      const timeRange = cleanText(
        xmlTag(item, "calendarEvent:EventTimes"),
      );
      const timeMatch = timeRange.match(
        /(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i,
      );
      const startTime = parseClock(timeMatch?.[1]);
      const endTime = parseClock(timeMatch?.[2]);
      if (!title || !sourceHref || !eventDate || !startTime || !endTime) {
        return null;
      }

      const startAt = localDateTimeToIso(eventDate, startTime);
      let endAt = localDateTimeToIso(eventDate, endTime);
      if (Date.parse(endAt) <= Date.parse(startAt)) {
        endAt = new Date(Date.parse(endAt) + 86_400_000).toISOString();
      }
      const rawDescription = xmlTag(item, "description");
      const details = descriptionParts(rawDescription);
      const feedLocation = cleanText(
        xmlTag(item, "calendarEvent:Location"),
      );
      const address =
        details.address || feedLocation || "San Francisco, CA";
      const venue = venueFor(title, address);
      const description = truncate(details.description, 420);
      const categories = inferCategories(title, description);
      const { cost, costLabel } = costDetails({ description });
      const eid = new URL(sourceHref).searchParams.get("EID");
      const unknowns = [
        "The organizer does not publish a confirmed age or minor-admission policy in the RSS record.",
      ];
      if (cost === null) {
        unknowns.push("The RSS record does not publish a price.");
      }

      return {
        id: `sfrecpark-${eid || slugify(`${title}-${eventDate}`)}`,
        title,
        shortTitle: truncate(title, 62),
        startAt,
        endAt,
        ...formatEventLabels(startAt, endAt),
        neighborhood:
          venue === "Union Square"
            ? "Union Square"
            : venue === "Golden Gate Bandshell"
              ? "Golden Gate Park"
              : "San Francisco",
        venue,
        address,
        latitude: null,
        longitude: null,
        categories,
        tags: [
          ...new Set([
            "SF Recreation & Parks",
            "Public calendar",
            ...categories,
          ]),
        ],
        ageTags: [],
        audienceLabel: "Audience not published",
        cost,
        costLabel,
        eligibility: "unknown",
        eligibilityLabel: "Age policy not published",
        format: "In person",
        registration: "See organizer page",
        registrationStatus: "unknown",
        source: "SF Recreation & Parks",
        sourceId: eid || sourceHref,
        sourcePlatform: "SF Rec Park",
        sourceHref,
        sourceDataset: "SF Rec Park · official calendar RSS",
        sourceDatasetHref: SF_REC_PARK_RSS_DIRECTORY,
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
        matchLabel: "City park calendar · current listing",
        matchReason:
          "A current public listing from San Francisco Recreation & Parks’ official event RSS feed.",
        description:
          description || `See the official calendar for details about ${title}.`,
        confidence:
          "Date, time, location, and canonical event link came from the official SF Recreation & Parks RSS feed.",
        unknowns,
      };
    })
    .filter(Boolean);
}

export async function fetchSfRecParkEvents({
  now = new Date(),
  horizonDays = 35,
  fetchImpl = fetch,
  signal,
  checkedAt = new Date().toISOString(),
} = {}) {
  const response = await fetchImpl(SF_REC_PARK_RSS_URL, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
      "User-Agent":
        "FindrCatalogSync/1.0 (+https://github.com/Srikamarthapu/Findr)",
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `SF Rec Park RSS request failed with HTTP ${response.status}.`,
    );
  }
  const events = parseSfRecParkRss(await response.text(), { checkedAt });
  const horizon = now.getTime() + horizonDays * 86_400_000;
  return events.filter(
    (event) =>
      Date.parse(event.endAt) > now.getTime() &&
      Date.parse(event.startAt) <= horizon,
  );
}
