import eventCatalog from "./events.json";
import catalogMetadata from "./catalog-meta.json";

export const events = eventCatalog;
export const catalogMeta = catalogMetadata;

export const categories = [
  "All",
  "AI & Startups",
  "Tech",
  "Career",
  "Creative",
  "Community",
];

export const nearbyAreas = [
  { name: "Mission", travel: "origin" },
  { name: "San Francisco", travel: "citywide" },
  { name: "Oakland", travel: "24 min" },
  { name: "Palo Alto", travel: "45+ min" },
  { name: "Menlo Park", travel: "45+ min" }
];

export const initialPreferences = {
  age: 16,
  origin: "Mission",
  date: "Next 30 days",
  maxCost: 20,
  level: "Any level",
  includeUnknownEligibility: true
};
