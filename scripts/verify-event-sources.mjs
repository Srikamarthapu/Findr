import { readFile } from "node:fs/promises";

const events = JSON.parse(
  await readFile(new URL("../src/events.json", import.meta.url), "utf8"),
);

function extractStructuredEvent(html) {
  const scripts = [
    ...html.matchAll(
      /<script[^>]+type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs,
    ),
  ];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]);
      const records = Array.isArray(parsed) ? parsed : [parsed];
      const event = records.find((record) => record?.["@type"] === "Event");
      if (event) return event;
    } catch {
      // Keep looking for another valid structured-data block.
    }
  }
  return null;
}

const failures = [];
for (const event of events) {
  try {
    const response = await fetch(event.sourceHref, {
      headers: { "User-Agent": "FindrSourceVerifier/1.0" },
    });
    const html = await response.text();
    const sourceEvent = extractStructuredEvent(html);
    if (!response.ok || !sourceEvent) {
      failures.push(`${event.id}: source page unavailable`);
      continue;
    }

    const sourcePrice = sourceEvent.offers?.find(
      (offer) => Number(offer.price) === event.cost,
    );
    if (sourceEvent.eventStatus !== "https://schema.org/EventScheduled") {
      failures.push(`${event.id}: source is not scheduled`);
    }
    if (Date.parse(sourceEvent.startDate) !== Date.parse(event.startAt)) {
      failures.push(`${event.id}: start time changed`);
    }
    if (Date.parse(sourceEvent.endDate) !== Date.parse(event.endAt)) {
      failures.push(`${event.id}: end time changed`);
    }
    if (!sourcePrice) {
      failures.push(`${event.id}: advertised price changed`);
    }
  } catch {
    failures.push(`${event.id}: source verification request failed`);
  }
}

if (failures.length) {
  console.error(`Event source verification failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Verified ${events.length} scheduled events against their canonical Luma structured data.`,
  );
}
