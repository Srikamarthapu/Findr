import { readFile } from "node:fs/promises";
import {
  verifyDirectEventLinks,
} from "../server/events/pipeline.mjs";
import { validateCatalog } from "../server/events/schema.mjs";

const events = JSON.parse(
  await readFile(new URL("../src/events.json", import.meta.url), "utf8"),
);
validateCatalog(events);

function structuredEventsFromHtml(html) {
  const records = [];
  for (const match of String(html).matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(match[1]);
      const candidates = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.["@graph"])
          ? parsed["@graph"]
          : [parsed];
      records.push(
        ...candidates.filter((record) => record?.["@type"] === "Event"),
      );
    } catch {
      // Continue to another structured-data block.
    }
  }
  return records;
}

async function verifyLuma(event) {
  const response = await fetch(event.sourceHref, {
    headers: {
      Accept: "text/html",
      "User-Agent":
        "FindrSourceVerifier/1.0 (+https://github.com/Srikamarthapu/Findr)",
    },
  });
  if (!response.ok) return "source page unavailable";
  const sourceEvent = structuredEventsFromHtml(await response.text()).find(
    (record) =>
      record.eventStatus === "https://schema.org/EventScheduled" &&
      Date.parse(record.startDate) === Date.parse(event.startAt),
  );
  if (!sourceEvent) return "scheduled structured data no longer matches";
  if (Date.parse(sourceEvent.endDate) !== Date.parse(event.endAt)) {
    return "end time changed";
  }
  const offers = [sourceEvent.offers || []].flat().filter(Boolean);
  if (
    offers.length &&
    offers.every((offer) =>
      /schema\.org\/(?:SoldOut|OutOfStock|Discontinued)$/i.test(
        String(offer?.availability || ""),
      ),
    )
  ) {
    return "registration is sold out";
  }
  if (event.cost !== null) {
    const prices = (sourceEvent.offers || [])
      .flat()
      .map((offer) => Number(offer?.price))
      .filter(Number.isFinite);
    if (prices.length && !prices.includes(event.cost)) {
      return "advertised price changed";
    }
  }
  return null;
}

const failures = [];
const now = Date.now();
const staleThreshold = 72 * 60 * 60 * 1000;
for (const event of events) {
  if (Date.parse(event.endAt) <= now) {
    failures.push(`${event.id}: event has ended; run npm run sync:events`);
  }
  if (now - Date.parse(event.sourceCheckedAt) > staleThreshold) {
    failures.push(`${event.id}: source check is older than 72 hours`);
  }
}

const nonLumaEvents = events.filter(
  (event) => event.sourcePlatform !== "Luma",
);
const reachable = await verifyDirectEventLinks(nonLumaEvents, {
  concurrency: 8,
  timeoutMs: 10_000,
});
const reachableIds = new Set(reachable.map((event) => event.id));
for (const event of nonLumaEvents) {
  if (!reachableIds.has(event.id)) {
    failures.push(`${event.id}: canonical source link is unreachable`);
  }
}

const recentStructuredCheckThreshold = 15 * 60 * 1000;
for (const event of events.filter(
  (candidate) =>
    candidate.sourcePlatform === "Luma" &&
    now - Date.parse(candidate.sourceCheckedAt) >
      recentStructuredCheckThreshold,
)) {
  try {
    const failure = await verifyLuma(event);
    if (failure) failures.push(`${event.id}: ${failure}`);
  } catch {
    failures.push(`${event.id}: Luma verification request failed`);
  }
}

if (failures.length) {
  console.error(`Event source verification failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const sourceCount = new Set(
    events.map((event) => event.sourceDataset),
  ).size;
  console.log(
    `Verified ${events.length} current real events across ${sourceCount} source feeds; all canonical links are reachable.`,
  );
}
