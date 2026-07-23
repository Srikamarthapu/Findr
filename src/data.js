import eventCatalog from "./events.json";

export const events = eventCatalog;

export const categories = ["All", "Tech", "Career", "Creative", "Community"];

export const nearbyAreas = [
  { name: "Mission", travel: "origin" },
  { name: "Financial District", travel: "18 min" },
  { name: "Fort Mason", travel: "26 min" },
  { name: "Menlo Park", travel: "45+ min" },
  { name: "San Francisco", travel: "citywide" }
];

export const initialPreferences = {
  age: 16,
  origin: "Mission",
  date: "Upcoming",
  maxCost: 20,
  level: "Any level",
  includeUnknownEligibility: true
};
