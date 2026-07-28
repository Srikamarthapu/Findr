const requiredStringFields = [
  "id",
  "title",
  "shortTitle",
  "startAt",
  "endAt",
  "dateLabel",
  "dateLong",
  "time",
  "neighborhood",
  "venue",
  "address",
  "costLabel",
  "eligibility",
  "eligibilityLabel",
  "format",
  "registration",
  "registrationStatus",
  "source",
  "sourceId",
  "sourcePlatform",
  "sourceHref",
  "sourceCheckedAt",
  "sourceDataset",
  "sourceType",
  "verificationStatus",
  "eventStatus",
  "image",
  "imageAlt",
  "matchLabel",
  "matchReason",
  "description",
  "confidence",
];

const requiredArrayFields = ["categories", "tags", "unknowns"];

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Catalog entries must be objects.");
  }

  for (const field of requiredStringFields) {
    if (typeof event[field] !== "string" || !event[field].trim()) {
      throw new Error(`Catalog event is missing ${field}.`);
    }
  }

  for (const field of requiredArrayFields) {
    if (
      !Array.isArray(event[field]) ||
      event[field].some(
        (value) => typeof value !== "string" || !value.trim(),
      )
    ) {
      throw new Error(`Catalog event ${event.id} has an invalid ${field}.`);
    }
  }

  if (!validDate(event.startAt) || !validDate(event.endAt)) {
    throw new Error(`Catalog event ${event.id} has an invalid schedule.`);
  }
  if (Date.parse(event.endAt) <= Date.parse(event.startAt)) {
    throw new Error(`Catalog event ${event.id} must end after it starts.`);
  }
  if (!validDate(event.sourceCheckedAt)) {
    throw new Error(
      `Catalog event ${event.id} has an invalid sourceCheckedAt.`,
    );
  }
  if (!validHttpsUrl(event.sourceHref)) {
    throw new Error(
      `Catalog event ${event.id} lacks a canonical HTTPS source URL.`,
    );
  }
  if (
    ["mock", "fixture", "demo", "sample"].some(
      (label) =>
        event.sourceType.toLowerCase() === label ||
        event.sourceDataset.toLowerCase().includes(label),
    )
  ) {
    throw new Error(`Catalog event ${event.id} is marked as mock data.`);
  }
  if (
    event.cost !== null &&
    (!Number.isFinite(event.cost) || event.cost < 0)
  ) {
    throw new Error(`Catalog event ${event.id} has an invalid cost.`);
  }
  if (!["unknown", "confirmed"].includes(event.eligibility)) {
    throw new Error(
      `Catalog event ${event.id} has an invalid eligibility state.`,
    );
  }
  if (event.verificationStatus !== "verified") {
    throw new Error(`Catalog event ${event.id} is not verified.`);
  }
  if (event.eventStatus !== "scheduled") {
    throw new Error(`Catalog event ${event.id} is not scheduled.`);
  }

  return event;
}

export function validateCatalog(events, { allowEmpty = false } = {}) {
  if (!Array.isArray(events) || (!allowEmpty && events.length === 0)) {
    throw new Error("The verified event catalog is empty.");
  }

  const ids = new Set();
  for (const event of events) {
    validateEvent(event);
    if (ids.has(event.id)) {
      throw new Error(`Catalog contains duplicate event id ${event.id}.`);
    }
    ids.add(event.id);
  }

  return events;
}
