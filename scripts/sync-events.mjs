import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCatalogMetadata,
  deduplicateEvents,
  fallbackSourceEvents,
  finalizeCatalog,
  refreshCuratedLumaEvents,
  selectDiverseEvents,
  verifyDirectEventLinks,
} from "../server/events/pipeline.mjs";
import {
  BIBLIOCOMMONS_LIBRARIES,
  fetchBibliocommonsEvents,
} from "../server/events/sources/bibliocommons.mjs";
import { fetchLumaDiscoverEvents } from "../server/events/sources/luma-discover.mjs";
import { fetchOur415Events } from "../server/events/sources/our415.mjs";
import { fetchSfRecParkEvents } from "../server/events/sources/sf-rec-park.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogPath = join(projectRoot, "src", "events.json");
const metadataPath = join(projectRoot, "src", "catalog-meta.json");
const args = new Set(process.argv.slice(2));
const verifyLinks = !args.has("--no-link-check");
const nowArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--now="));
const now = nowArgument
  ? new Date(nowArgument.slice("--now=".length))
  : new Date();
if (!Number.isFinite(now.getTime())) {
  throw new Error("Invalid --now value.");
}
const checkedAt = new Date().toISOString();
const currentCatalog = JSON.parse(await readFile(catalogPath, "utf8"));
const warnings = [];

async function withFallback(name, task, fallback) {
  try {
    const events = await task();
    console.log(`${name}: fetched ${events.length} current candidates`);
    return events;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${name}: ${message}`);
    const events = fallback();
    console.warn(`${name}: using ${events.length} snapshot records (${message})`);
    return events;
  }
}

const [our415Raw, sfRecParkRaw, lumaDiscoverRaw, ...libraryRaw] =
  await Promise.all([
  withFallback(
    "DataSF Our415",
    () =>
      fetchOur415Events({
        now,
        horizonDays: 35,
        appToken: process.env.DATASF_APP_TOKEN,
        checkedAt,
      }),
    () =>
      fallbackSourceEvents(
        currentCatalog,
        (event) => event.sourceType === "open-data",
        { now, horizonDays: 35 },
      ),
  ),
  withFallback(
    "SF Rec Park RSS",
    () =>
      fetchSfRecParkEvents({
        now,
        horizonDays: 35,
        checkedAt,
      }),
    () =>
      fallbackSourceEvents(
        currentCatalog,
        (event) =>
          event.sourceDataset === "SF Rec Park · official calendar RSS",
        { now, horizonDays: 35 },
      ),
  ),
  withFallback(
    "Luma San Francisco iCal",
    () =>
      fetchLumaDiscoverEvents({
        now,
        horizonDays: 35,
        checkedAt,
      }),
    () =>
      fallbackSourceEvents(
        currentCatalog,
        (event) =>
          event.sourceDataset ===
          "Luma San Francisco · official city iCal",
        { now, horizonDays: 35 },
      ),
  ),
  ...BIBLIOCOMMONS_LIBRARIES.map((library) =>
    withFallback(
      `${library.name} RSS`,
      () =>
        fetchBibliocommonsEvents({
          library,
          now,
          horizonDays: 21,
          checkedAt,
        }),
      () =>
        fallbackSourceEvents(
          currentCatalog,
          (event) =>
            event.sourceDataset ===
            `${library.name} · official event RSS`,
          { now, horizonDays: 21 },
        ),
    ),
  ),
  ]);

const our415Sfpl = our415Raw.filter(
  (event) => event.sourcePlatform === "SFPL",
);
const our415Community = our415Raw.filter(
  (event) => event.sourcePlatform !== "SFPL",
);

let selectedOur415 = [
  ...selectDiverseEvents(our415Sfpl, {
    limit: 32,
    maxPerDay: 4,
    maxPerVenue: 2,
    maxPerTitle: 1,
  }),
  ...selectDiverseEvents(our415Community, {
    limit: 8,
    maxPerDay: 3,
    maxPerVenue: 2,
    maxPerTitle: 1,
    maxPerOrganizer: 3,
  }),
];
if (verifyLinks && selectedOur415.length) {
  const before = selectedOur415.length;
  selectedOur415 = await verifyDirectEventLinks(selectedOur415);
  console.log(
    `DataSF direct links: ${selectedOur415.length}/${before} reachable`,
  );
}

const selectedSfRecPark = selectDiverseEvents(sfRecParkRaw, {
  limit: 14,
  maxPerDay: 4,
  maxPerVenue: 3,
  maxPerTitle: 2,
});
const selectedLumaDiscover = selectDiverseEvents(lumaDiscoverRaw, {
  limit: 24,
  maxPerDay: 5,
  maxPerVenue: 3,
  maxPerTitle: 1,
  maxPerOrganizer: 4,
});
const selectedLibraries = libraryRaw.flatMap((events, index) =>
  selectDiverseEvents(events, {
    limit: index === 0 ? 14 : 12,
    maxPerDay: 4,
    maxPerVenue: 2,
    maxPerTitle: 1,
  }),
);
const curatedLuma = await withFallback(
  "Curated Luma pages",
  () =>
    refreshCuratedLumaEvents(currentCatalog, {
      now,
      checkedAt,
    }),
  () =>
    fallbackSourceEvents(
      currentCatalog,
      (event) => event.sourcePlatform === "Luma",
      { now, horizonDays: 45 },
    ),
);

const catalog = finalizeCatalog(
  deduplicateEvents([
    ...selectedOur415,
    ...selectedSfRecPark,
    ...selectedLumaDiscover,
    ...selectedLibraries,
    ...curatedLuma,
  ]),
  { now },
);
const metadata = buildCatalogMetadata(catalog, {
  generatedAt: checkedAt,
  warnings,
});

const catalogTempPath = `${catalogPath}.tmp`;
const metadataTempPath = `${metadataPath}.tmp`;
await writeFile(catalogTempPath, `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(metadataTempPath, `${JSON.stringify(metadata, null, 2)}\n`);
await rename(catalogTempPath, catalogPath);
await rename(metadataTempPath, metadataPath);

console.log(
  `Wrote ${catalog.length} real events from ${metadata.sources.length} source feeds.`,
);
for (const source of metadata.sources) {
  console.log(`- ${source.name}: ${source.count}`);
}
if (warnings.length) {
  console.warn(`Completed with ${warnings.length} source warning(s).`);
}
