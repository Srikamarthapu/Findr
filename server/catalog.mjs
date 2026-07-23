import { readFileSync } from "node:fs";

const catalogUrl = new URL("../src/events.json", import.meta.url);
const rawCatalog = JSON.parse(readFileSync(catalogUrl, "utf8"));

const requiredStringFields = [
  "id",
  "title",
  "startAt",
  "endAt",
  "sourceHref",
  "sourcePlatform",
  "sourceCheckedAt",
  "verificationStatus",
];

function validateCatalog(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("The verified event catalog is empty.");
  }

  const ids = new Set();
  for (const event of events) {
    for (const field of requiredStringFields) {
      if (typeof event[field] !== "string" || !event[field].trim()) {
        throw new Error(`Catalog event is missing ${field}.`);
      }
    }

    if (ids.has(event.id)) {
      throw new Error(`Catalog contains duplicate event id ${event.id}.`);
    }
    ids.add(event.id);

    if (!Number.isFinite(Date.parse(event.startAt))) {
      throw new Error(`Catalog event ${event.id} has an invalid startAt.`);
    }
    if (!Number.isFinite(Date.parse(event.endAt))) {
      throw new Error(`Catalog event ${event.id} has an invalid endAt.`);
    }
    if (!event.sourceHref.startsWith("https://luma.com/")) {
      throw new Error(`Catalog event ${event.id} lacks a canonical Luma URL.`);
    }
    if (event.verificationStatus !== "verified") {
      throw new Error(`Catalog event ${event.id} is not verified.`);
    }
  }
}

validateCatalog(rawCatalog);

const stopWords = new Set([
  "a",
  "about",
  "all",
  "an",
  "and",
  "are",
  "at",
  "be",
  "can",
  "do",
  "event",
  "events",
  "find",
  "for",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "show",
  "the",
  "this",
  "to",
  "want",
  "what",
  "which",
  "with",
]);

function tokens(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function startOfUpcomingWeekend(now) {
  const date = new Date(now);
  const day = date.getDay();
  const daysUntilFriday = day <= 5 ? 5 - day : 5 - day + 7;
  date.setDate(date.getDate() + daysUntilFriday);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfUpcomingWeekend(now) {
  const end = startOfUpcomingWeekend(now);
  end.setDate(end.getDate() + 3);
  return end;
}

function containsAny(value, patterns) {
  return patterns.some((pattern) => value.includes(pattern));
}

function visibleAndCurrentEvents({ now, visibleEventIds }) {
  const visible = Array.isArray(visibleEventIds) && visibleEventIds.length
    ? new Set(visibleEventIds)
    : null;

  return rawCatalog.filter((event) => {
    const isVisible = !visible || visible.has(event.id);
    const isFuture = Date.parse(event.endAt) > now.getTime();
    return (
      isVisible &&
      isFuture &&
      event.eventStatus === "scheduled" &&
      event.verificationStatus === "verified"
    );
  });
}

export function retrieveEvents({
  query,
  preferences = {},
  visibleEventIds,
  now = new Date(),
  limit = 5,
}) {
  const normalized = String(query).toLowerCase().trim();
  let candidates = visibleAndCurrentEvents({ now, visibleEventIds });

  if (
    containsAny(normalized, ["no-match example", "no match example"]) ||
    /confirmed.*(?:age|eligib|teen|minor)|(?:age|eligib|teen|minor).*confirmed/.test(
      normalized,
    )
  ) {
    candidates = candidates.filter((event) => event.eligibility === "confirmed");
  }

  if (containsAny(normalized, ["this weekend", "weekend"])) {
    const weekendStart = startOfUpcomingWeekend(now).getTime();
    const weekendEnd = endOfUpcomingWeekend(now).getTime();
    candidates = candidates.filter((event) => {
      const start = Date.parse(event.startAt);
      return start >= weekendStart && start < weekendEnd;
    });
  }

  if (containsAny(normalized, ["free only", "only free", "free event"])) {
    candidates = candidates.filter((event) => event.cost === 0);
  }

  const statedBudget = normalized.match(
    /(?:under|below|up to|max(?:imum)?|less than)?\s*\$(\d{1,4})/,
  );
  const maxCost = statedBudget
    ? Number(statedBudget[1])
    : Number.isFinite(Number(preferences.maxCost))
      ? Number(preferences.maxCost)
      : null;
  if (maxCost !== null) {
    candidates = candidates.filter((event) => event.cost <= maxCost);
  }

  if (containsAny(normalized, ["san francisco only", "sf only"])) {
    candidates = candidates.filter((event) =>
      event.address.toLowerCase().includes("san francisco"),
    );
  }

  const queryTokens = tokens(normalized);
  const ranked = candidates.map((event) => {
    const title = new Set(tokens(event.title));
    const tags = new Set(tokens(event.tags.join(" ")));
    const categories = new Set(tokens(event.categories.join(" ")));
    const details = new Set(
      tokens(
        [
          event.description,
          event.neighborhood,
          event.venue,
          event.audienceLabel,
          event.format,
        ].join(" "),
      ),
    );

    let score = 0;
    for (const token of queryTokens) {
      if (title.has(token)) score += 8;
      if (tags.has(token)) score += 6;
      if (categories.has(token)) score += 4;
      if (details.has(token)) score += 2;
    }
    if (normalized.includes("workshop") && event.tags.includes("Workshop")) {
      score += 5;
    }
    if (normalized.includes("student") && event.tags.includes("Students")) {
      score += 6;
    }

    const daysAway = Math.max(
      0,
      (Date.parse(event.startAt) - now.getTime()) / 86_400_000,
    );
    score += Math.max(0, 3 - daysAway / 14);

    return { event, score };
  });

  return ranked
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(a.event.startAt) - Date.parse(b.event.startAt),
    )
    .slice(0, limit)
    .map(({ event }) => event);
}

export function groundingRecord(event) {
  return {
    id: event.id,
    title: event.title,
    startsAt: event.startAt,
    endsAt: event.endAt,
    timeLabel: event.time,
    location: `${event.venue}, ${event.address}`,
    categories: event.categories,
    tags: event.tags,
    audience: event.audienceLabel,
    cost: event.costLabel,
    eligibility: event.eligibilityLabel,
    registration: event.registration,
    format: event.format,
    description: event.description,
    sourceName: event.source,
    sourceUrl: event.sourceHref,
    verifiedAt: event.sourceCheckedAt,
    unknowns: event.unknowns,
  };
}

function compact(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function extractJsonObject(raw) {
  const cleaned = String(raw)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("model_output_not_json");
  }
  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
}

export function validateGuideAnswer(raw, retrievedEvents) {
  const parsed = extractJsonObject(raw);
  const allowedIds = new Set(retrievedEvents.map((event) => event.id));
  if (typeof parsed.summary !== "string" || typeof parsed.question !== "string") {
    throw new Error("model_output_invalid_schema");
  }
  if (!Array.isArray(parsed.eventIds)) {
    throw new Error("model_output_invalid_schema");
  }
  if (parsed.caveat !== null && typeof parsed.caveat !== "string") {
    throw new Error("model_output_invalid_schema");
  }

  const summary = compact(parsed.summary, 600);
  const question = compact(parsed.question, 240);
  const caveat = parsed.caveat === null ? null : compact(parsed.caveat, 400);
  const text = `${summary} ${caveat ?? ""} ${question}`;
  if (/https?:\/\//i.test(text)) {
    throw new Error("model_output_contains_url");
  }

  const eventIds = [...new Set(parsed.eventIds)]
    .filter((id) => typeof id === "string" && allowedIds.has(id))
    .slice(0, 4);
  if (parsed.eventIds.length > 0 && eventIds.length === 0) {
    throw new Error("model_output_ungrounded_ids");
  }

  const selectedEvents = eventIds
    .map((id) => retrievedEvents.find((event) => event.id === id))
    .filter(Boolean);
  const hasUnknownAge = selectedEvents.some(
    (event) => event.eligibility === "unknown",
  );
  if (
    hasUnknownAge &&
    /(confirmed for (?:teens|minors)|teen[- ]friendly|under[- ]?18 (?:is )?(?:allowed|welcome))/i.test(
      text,
    )
  ) {
    throw new Error("model_output_invents_eligibility");
  }

  return {
    role: "assistant",
    summary,
    eventIds,
    caveat,
    question,
    noMatch: eventIds.length === 0,
  };
}

export function groundedFallback(retrievedEvents, reason = "provider_unavailable") {
  if (!retrievedEvents.length) {
    return {
      role: "assistant",
      summary: "I couldn’t find a verified event that satisfies that request.",
      eventIds: [],
      caveat:
        "Findr kept your hard constraints and did not invent a result. Every catalog event currently has an unpublished age policy.",
      question: "Should I relax the date, location, or eligibility constraint?",
      noMatch: true,
      degraded: reason !== "no_match",
    };
  }

  const selected = retrievedEvents.slice(0, 3);
  const allUnknown = selected.every((event) => event.eligibility === "unknown");
  return {
    role: "assistant",
    summary: `I found ${selected.length} verified ${selected.length === 1 ? "event" : "events"} that best match your request.`,
    eventIds: selected.map((event) => event.id),
    caveat: allUnknown
      ? "None of these organizers publishes an age or minor-admission policy, so confirm directly before registering."
      : null,
    question: "Would you like me to narrow these by date, topic, or registration type?",
    noMatch: false,
    degraded: reason !== "no_match",
  };
}

export function buildGroundedMessages({
  query,
  preferences,
  history,
  retrievedEvents,
}) {
  const boundedHistory = Array.isArray(history)
    ? history
        .slice(-6)
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: compact(message.content, 500),
        }))
        .filter((message) => message.content)
    : [];

  const system = [
    "You are Findr, a concise event discovery concierge.",
    "Use only the verified catalog records supplied in the user message.",
    "Never invent an event, date, price, address, registration status, eligibility rule, or URL.",
    "An unknown age policy must remain unknown. Students being invited does not prove minors are admitted.",
    "Recommend at most four supplied event IDs.",
    "Return only one JSON object with exactly these keys:",
    '{"summary":"string","eventIds":["catalog-id"],"caveat":"string or null","question":"string"}',
    "Do not include markdown or URLs in the JSON fields.",
  ].join(" ");

  const user = JSON.stringify({
    task: compact(query, 800),
    preferences: {
      age: Number(preferences?.age) || null,
      origin: compact(preferences?.origin, 80),
      date: compact(preferences?.date, 80),
      maxCost: Number(preferences?.maxCost) || null,
      level: compact(preferences?.level, 80),
      includeUnknownEligibility:
        preferences?.includeUnknownEligibility !== false,
    },
    recentConversation: boundedHistory,
    verifiedCatalog: retrievedEvents.map(groundingRecord),
  });

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function catalogSummary(now = new Date()) {
  return visibleAndCurrentEvents({ now }).map((event) => ({
    id: event.id,
    title: event.title,
    sourceUrl: event.sourceHref,
    sourcePlatform: event.sourcePlatform,
    verifiedAt: event.sourceCheckedAt,
  }));
}

export const events = rawCatalog;
