import catalogMeta from "../src/catalog-meta.json" with { type: "json" };
import { catalogSummary } from "./catalog.mjs";

export function catalogHealth(now = new Date()) {
  return {
    count: catalogSummary(now).length,
    generatedAt: catalogMeta.generatedAt,
    verifiedAt: catalogMeta.generatedAt,
    sources: catalogMeta.sources.map((source) => ({
      name: source.name,
      type: source.type,
      count: source.count,
      checkedAt: source.checkedAt,
    })),
  };
}
