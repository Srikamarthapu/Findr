import { createHash } from "node:crypto";
import {
  canonicalHttpsUrl,
  cleanText,
  sourceCheckLabel,
  slugify,
} from "./normalize.mjs";
import { validateCatalog } from "./schema.mjs";

function canonicalComparisonUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

function titleFingerprint(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function deduplicateEvents(events) {
  const seenUrls = new Set();
  const seenSourceIds = new Set();
  const seenFingerprints = new Set();
  const output = [];

  for (const event of [...events].sort(
    (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt),
  )) {
    const urlKey = canonicalComparisonUrl(event.sourceHref);
    const sourceKey = `${event.sourcePlatform}:${event.sourceId}`.toLowerCase();
    const fingerprint = [
      titleFingerprint(event.title),
      event.startAt.slice(0, 16),
      titleFingerprint(event.venue),
    ].join("|");

    if (
      seenUrls.has(urlKey) ||
      seenSourceIds.has(sourceKey) ||
      seenFingerprints.has(fingerprint)
    ) {
      continue;
    }
    seenUrls.add(urlKey);
    seenSourceIds.add(sourceKey);
    seenFingerprints.add(fingerprint);
    output.push(event);
  }

  return output;
}

export function selectDiverseEvents(
  events,
  {
    limit,
    maxPerDay = 5,
    maxPerVenue = 3,
    maxPerTitle = 1,
    maxPerOrganizer = Number.POSITIVE_INFINITY,
  },
) {
  const selected = [];
  const dayCounts = new Map();
  const venueCounts = new Map();
  const titleCounts = new Map();
  const organizerCounts = new Map();

  const tryAdd = (event, relaxed = false) => {
    if (selected.includes(event)) return false;
    const day = event.startAt.slice(0, 10);
    const venue = titleFingerprint(event.venue);
    const title = titleFingerprint(event.title);
    const organizer = cleanText(event.source).toLowerCase();
    if (!relaxed) {
      if ((dayCounts.get(day) || 0) >= maxPerDay) return false;
      if ((venueCounts.get(venue) || 0) >= maxPerVenue) return false;
      if ((titleCounts.get(title) || 0) >= maxPerTitle) return false;
      if ((organizerCounts.get(organizer) || 0) >= maxPerOrganizer) {
        return false;
      }
    }
    selected.push(event);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    venueCounts.set(venue, (venueCounts.get(venue) || 0) + 1);
    titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    organizerCounts.set(
      organizer,
      (organizerCounts.get(organizer) || 0) + 1,
    );
    return true;
  };

  const sorted = [...events].sort(
    (a, b) =>
      Date.parse(a.startAt) - Date.parse(b.startAt) ||
      a.title.localeCompare(b.title),
  );

  for (const event of sorted) {
    if (selected.length >= limit) break;
    tryAdd(event);
  }
  for (const event of sorted) {
    if (selected.length >= limit) break;
    tryAdd(event, true);
  }

  return selected;
}

export function structuredEventsFromHtml(html) {
  const records = [];
  const scripts = [
    ...String(html).matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1]);
      const candidates = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.["@graph"])
          ? parsed["@graph"]
          : [parsed];
      records.push(
        ...candidates.filter((record) => record?.["@type"] === "Event"),
      );
    } catch {
      // A page can contain unrelated invalid JSON-LD blocks.
    }
  }
  return records;
}

function availableStructuredOffers(record) {
  const offers = [record?.offers || []].flat().filter(Boolean);
  const available = offers.filter(
    (offer) =>
      !/schema\.org\/(?:SoldOut|OutOfStock|Discontinued)$/i.test(
        String(offer.availability || ""),
      ),
  );
  return { offers, available };
}

export async function refreshCuratedLumaEvents(
  events,
  {
    now = new Date(),
    checkedAt = new Date().toISOString(),
    fetchImpl = fetch,
    signal,
  } = {},
) {
  const candidates = events.filter((event) => {
    try {
      return (
        event.sourceType === "curated" &&
        new URL(event.sourceHref).hostname === "luma.com" &&
        Date.parse(event.endAt) > now.getTime()
      );
    } catch {
      return false;
    }
  });

  const refreshed = await Promise.all(
    candidates.map(async (event) => {
      try {
        const response = await fetchImpl(event.sourceHref, {
          headers: {
            Accept: "text/html",
            "User-Agent":
              "FindrCatalogSync/1.0 (+https://github.com/Srikamarthapu/Findr)",
          },
          signal,
        });
        if (!response.ok) return null;
        const sourceEvent = structuredEventsFromHtml(await response.text())
          .find(
            (record) =>
              record.eventStatus === "https://schema.org/EventScheduled" &&
              Date.parse(record.startDate) === Date.parse(event.startAt),
        );
        if (!sourceEvent) return null;
        const { offers, available } = availableStructuredOffers(sourceEvent);
        if (offers.length && !available.length) return null;
        const startAt = new Date(sourceEvent.startDate).toISOString();
        const endAt = new Date(sourceEvent.endDate).toISOString();
        if (Date.parse(endAt) <= now.getTime()) return null;
        const prices = available
          .map((offer) => Number(offer.price))
          .filter(Number.isFinite);
        const cost = prices.length ? Math.min(...prices) : event.cost;
        const costLabel =
          cost === 0
            ? "Free"
            : Number.isFinite(cost)
              ? `${prices.length > 1 ? "From " : ""}$${Number.isInteger(cost) ? cost : cost.toFixed(2)}`
              : event.costLabel;

        return {
          ...event,
          startAt,
          endAt,
          cost,
          costLabel,
          registration: available.length
            ? "Registration available"
            : event.registration,
          registrationStatus: available.length
            ? "open"
            : event.registrationStatus,
          sourceId:
            event.sourceId || new URL(event.sourceHref).pathname.slice(1),
          sourceDataset: "Organizer-hosted Luma event page",
          sourceDatasetHref: event.sourceHref,
          sourceType: "curated",
          sourceDataAt: checkedAt,
          sourceCheckedAt: checkedAt,
          checked: sourceCheckLabel(checkedAt),
          verificationStatus: "verified",
          eventStatus: "scheduled",
        };
      } catch {
        return null;
      }
    }),
  );

  return refreshed.filter(Boolean);
}

async function checkLink(event, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetchImpl(event.sourceHref, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent":
          "FindrCatalogSync/1.0 (+https://github.com/Srikamarthapu/Findr)",
      },
      signal: controller.signal,
    });
    if ([405, 501].includes(response.status)) {
      response = await fetchImpl(event.sourceHref, {
        method: "GET",
        redirect: "follow",
        headers: {
          Range: "bytes=0-2048",
          "User-Agent":
            "FindrCatalogSync/1.0 (+https://github.com/Srikamarthapu/Findr)",
        },
        signal: controller.signal,
      });
      await response.body?.cancel();
    }
    return ![404, 410].includes(response.status) && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyDirectEventLinks(
  events,
  {
    fetchImpl = fetch,
    concurrency = 8,
    timeoutMs = 8_000,
  } = {},
) {
  const verified = [];
  let cursor = 0;

  async function worker() {
    while (cursor < events.length) {
      const event = events[cursor];
      cursor += 1;
      if (await checkLink(event, { fetchImpl, timeoutMs })) {
        verified.push(event);
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

export function finalizeCatalog(events, { now = new Date() } = {}) {
  const current = events
    .filter((event) => Date.parse(event.endAt) > now.getTime())
    .map((event) => ({
      ...event,
      sourceHref: canonicalHttpsUrl(event.sourceHref),
      catalogHash: createHash("sha256")
        .update(
          JSON.stringify([
            event.sourcePlatform,
            event.sourceId,
            event.title,
            event.startAt,
            event.endAt,
            event.venue,
            event.sourceHref,
          ]),
        )
        .digest("hex")
        .slice(0, 16),
    }))
    .sort(
      (a, b) =>
        Date.parse(a.startAt) - Date.parse(b.startAt) ||
        a.title.localeCompare(b.title),
    );

  validateCatalog(current);
  return current;
}

export function buildCatalogMetadata(
  events,
  { generatedAt = new Date().toISOString(), warnings = [] } = {},
) {
  const sources = new Map();
  for (const event of events) {
    const key = event.sourceDataset;
    const current = sources.get(key) || {
      name: key,
      href: event.sourceDatasetHref || event.sourceHref,
      type: event.sourceType,
      count: 0,
      checkedAt: event.sourceCheckedAt,
      dataAt: event.sourceDataAt || event.sourceCheckedAt,
    };
    current.count += 1;
    if (Date.parse(event.sourceCheckedAt) > Date.parse(current.checkedAt)) {
      current.checkedAt = event.sourceCheckedAt;
    }
    sources.set(key, current);
  }

  return {
    generatedAt,
    recordCount: events.length,
    firstEventAt: events[0]?.startAt || null,
    lastEventAt: events.at(-1)?.startAt || null,
    sources: [...sources.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    warnings,
    contract: {
      mockRecordsAllowed: false,
      directEventLinksRequired: true,
      eligibilityTagsAreHints: true,
      committedSnapshotFallback: true,
    },
  };
}

export function fallbackSourceEvents(
  events,
  predicate,
  { now = new Date(), horizonDays = 35 } = {},
) {
  const horizon = now.getTime() + horizonDays * 86_400_000;
  return events.filter(
    (event) =>
      predicate(event) &&
      Date.parse(event.endAt) > now.getTime() &&
      Date.parse(event.startAt) <= horizon,
  );
}

export function sourceSlug(event) {
  return slugify(event.sourceDataset || event.sourcePlatform);
}
