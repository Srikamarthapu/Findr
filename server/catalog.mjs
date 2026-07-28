import rawCatalog from "../src/events.json" with { type: "json" };
import { validateCatalog } from "./events/schema.mjs";

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

function expandedQueryTokens(value) {
  const normalized = String(value).toLowerCase();
  const expanded = new Set(tokens(normalized));
  const aliasGroups = [
    {
      pattern: /\b(ai|artificial intelligence|machine learning)\b/,
      aliases: ["ai", "agent", "llm", "machine", "learning", "mcp", "model"],
    },
    {
      pattern: /\b(startup|founder|entrepreneur)\b/,
      aliases: [
        "startup",
        "founder",
        "entrepreneur",
        "venture",
        "investor",
        "pitch",
        "yc",
      ],
    },
    {
      pattern: /\b(hackathon|builder|build night)\b/,
      aliases: ["hackathon", "builder", "coding", "developer", "engineering"],
    },
    {
      pattern: /\b(demo|showcase|show and tell)\b/,
      aliases: ["demo", "showcase", "launch", "product"],
    },
    {
      pattern: /\b(research|paper|academic)\b/,
      aliases: ["research", "researcher", "paper", "academic", "phd"],
    },
    {
      pattern: /\b(network|networking|meetup)\b/,
      aliases: ["networking", "meetup", "community", "founder"],
    },
    {
      pattern: /\b(robot|robotics|physical ai)\b/,
      aliases: ["robot", "robotics", "physical", "hardware", "embodied", "ai"],
    },
  ];
  for (const group of aliasGroups) {
    if (group.pattern.test(normalized)) {
      for (const alias of group.aliases) expanded.add(alias);
    }
  }
  return [...expanded];
}

function visibleAndCurrentEvents({ now, visibleEventIds }) {
  const visible = Array.isArray(visibleEventIds)
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
    candidates = candidates.filter(
      (event) => Number.isFinite(event.cost) && event.cost <= maxCost,
    );
  }

  const locationPreference = String(preferences.origin || "").toLowerCase();
  const broadLocation =
    !locationPreference ||
    containsAny(locationPreference, [
      "anywhere",
      "bay area",
      "nearby",
      "no preference",
    ]);
  if (!broadLocation) {
    const requestedLocations = [
      ["san francisco", ["san francisco", "sfpl", "sf rec park"]],
      ["oakland", ["oakland"]],
      ["berkeley", ["berkeley"]],
      ["palo alto", ["palo alto"]],
      ["peninsula", ["palo alto", "menlo park", "redwood city"]],
      ["silicon valley", ["palo alto", "menlo park", "mountain view"]],
      ["san jose", ["san jose"]],
    ]
      .filter(([label]) => locationPreference.includes(label))
      .flatMap(([, patterns]) => patterns);
    if (requestedLocations.length) {
      candidates = candidates.filter((event) => {
        const locationText = [
          event.address,
          event.neighborhood,
          event.venue,
          event.sourcePlatform,
        ]
          .join(" ")
          .toLowerCase();
        return requestedLocations.some((pattern) =>
          locationText.includes(pattern),
        );
      });
    }
  }

  if (containsAny(normalized, ["san francisco only", "sf only"])) {
    candidates = candidates.filter((event) => {
      const locationText = [
        event.address,
        event.neighborhood,
        event.venue,
        event.sourcePlatform,
      ]
        .join(" ")
        .toLowerCase();
      return (
        locationText.includes("san francisco") ||
        locationText.includes("sfpl") ||
        locationText.includes("sf rec park")
      );
    });
  }

  const availability = `${normalized} ${preferences.date || ""}`.toLowerCase();
  if (containsAny(availability, ["next two weeks", "next 2 weeks"])) {
    const end = now.getTime() + 14 * 86_400_000;
    candidates = candidates.filter(
      (event) => Date.parse(event.startAt) <= end,
    );
  }
  if (containsAny(availability, ["weeknight", "weekday evening"])) {
    candidates = candidates.filter((event) => {
      const date = new Date(event.startAt);
      const parts = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        hour: "numeric",
        hourCycle: "h23",
        timeZone: "America/Los_Angeles",
      }).formatToParts(date);
      const weekday = parts.find((part) => part.type === "weekday")?.value;
      const hour = Number(
        parts.find((part) => part.type === "hour")?.value,
      );
      return !["Sat", "Sun"].includes(weekday) && hour >= 16;
    });
  }

  const queryTokens = expandedQueryTokens(normalized);
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
          event.ageTags?.join(" "),
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
    const age = Number(preferences.age);
    const ageText = (event.ageTags || []).join(" ").toLowerCase();
    if (Number.isFinite(age)) {
      if (
        age < 18 &&
        /\b(teen|tween|youth|grade school)\b/.test(ageText)
      ) {
        score += 8;
      }
      if (age >= 18 && /\b(adult|tay|18-24)\b/.test(ageText)) {
        score += 6;
      }
      if (
        age >= 13 &&
        !/\b(family|parent)\b/.test(normalized) &&
        /\b(bab|birth|preschool|toddler)\b/.test(ageText)
      ) {
        score -= 10;
      }
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
    sourceDataset: event.sourceDataset,
    sourceUrl: event.sourceHref,
    verifiedAt: event.sourceCheckedAt,
    sourceDataAt: event.sourceDataAt,
    audienceHints: event.ageTags || [],
    confidence: event.confidence,
    unknowns: event.unknowns,
  };
}

function compact(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function replaceCatalogIds(value, retrievedEvents) {
  let cleaned = String(value ?? "");
  const replacements = [...retrievedEvents]
    .filter(
      (event) =>
        typeof event?.id === "string" &&
        event.id &&
        typeof event?.title === "string" &&
        event.title,
    )
    .sort((a, b) => b.id.length - a.id.length);
  for (const event of replacements) {
    cleaned = cleaned.split(event.id).join(event.title);
  }
  return cleaned;
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

  const summary = compact(
    replaceCatalogIds(parsed.summary, retrievedEvents),
    600,
  );
  const question = compact(
    replaceCatalogIds(parsed.question, retrievedEvents),
    240,
  );
  const caveat =
    parsed.caveat === null
      ? null
      : compact(replaceCatalogIds(parsed.caveat, retrievedEvents), 400);
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

export function conversationalFallback({
  intake,
  question,
  reason = "provider_unavailable",
}) {
  if (intake && !intake.complete) {
    return {
      role: "assistant",
      summary:
        "I’m here to help, and I’ll keep your event profile focused on what you actually want.",
      eventIds: [],
      caveat:
        reason === "provider_unavailable"
          ? "The live conversation model is temporarily unavailable."
          : null,
      question,
      noMatch: false,
      degraded: true,
    };
  }
  return {
    role: "assistant",
    summary:
      "I can chat briefly, but my strongest role here is helping you discover source-verified events.",
    eventIds: [],
    caveat:
      reason === "provider_unavailable"
        ? "The live conversation model is temporarily unavailable."
        : null,
    question: "Would you like to find an event or refine your preferences?",
    noMatch: false,
    degraded: true,
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

function boundedConversationHistory(history) {
  return Array.isArray(history)
    ? history
        .slice(-6)
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: compact(message.content, 500),
          ...(message.role === "assistant" &&
          Array.isArray(message.eventIds) &&
          message.eventIds.length
            ? {
                eventIds: message.eventIds
                  .filter((id) => typeof id === "string")
                  .slice(0, 4),
              }
            : {}),
        }))
        .filter((message) => message.content)
    : [];
}

export function buildGroundedMessages({
  query,
  preferences,
  history,
  retrievedEvents,
}) {
  const boundedHistory = boundedConversationHistory(history);

  const system = [
    "You are Findr, a concise event discovery concierge.",
    "Use only the verified catalog records supplied in the user message.",
    "Never invent an event, date, price, address, registration status, eligibility rule, or URL.",
    "An unknown age policy must remain unknown. Students being invited does not prove minors are admitted.",
    "Recommend at most four supplied event IDs.",
    "Catalog IDs are internal. Mention event titles, never raw catalog IDs, in summary, caveat, or question.",
    "Return only one JSON object with exactly these keys:",
    '{"summary":"string","eventIds":["catalog-id"],"caveat":"string or null","question":"string"}',
    "Do not include markdown or URLs in the JSON fields.",
  ].join(" ");

  const user = JSON.stringify({
    task: compact(query, 800),
    preferences: {
      age: finiteNumberOrNull(preferences?.age),
      origin: compact(preferences?.origin, 80),
      date: compact(preferences?.date, 80),
      maxCost: finiteNumberOrNull(preferences?.maxCost),
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

export function buildConversationMessages({
  query,
  history,
  profile,
  intake,
  requiredQuestion = null,
}) {
  const collectingProfile = Boolean(intake && !intake.complete);
  const system = [
    "You are Findr, a warm, concise event discovery concierge.",
    "Respond naturally to the user's greeting, small talk, partial answer, or general question.",
    "Address the user directly. Never narrate the exchange or refer to them as 'the user'.",
    collectingProfile
      ? "The event profile is incomplete. Do not retrieve, name, or recommend any events yet."
      : "This turn is general conversation, not an event search. Do not name or recommend events.",
    "Return only one JSON object with exactly these keys:",
    '{"summary":"string","eventIds":[],"caveat":"string or null","question":"string"}',
    "eventIds must be an empty array. Do not include markdown, URLs, or raw catalog IDs.",
    collectingProfile
      ? `The question field must be exactly ${JSON.stringify(requiredQuestion)}.`
      : "Use the question field for one brief, relevant follow-up or an offer to return to event discovery.",
  ].join(" ");

  const user = JSON.stringify({
    task: compact(query, 800),
    profile: {
      age: finiteNumberOrNull(profile?.age),
      interests: compact(profile?.interests, 160),
      locations: compact(profile?.locations, 160),
      datePreference: compact(profile?.datePreference, 120),
      maxCost: finiteNumberOrNull(profile?.maxCost),
      budgetFlexibility: compact(profile?.budgetFlexibility, 20),
    },
    nextMissingField: collectingProfile ? intake.nextField : null,
    recentConversation: boundedConversationHistory(history),
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
