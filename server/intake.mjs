const FIELD_ORDER = [
  "age",
  "interests",
  "locations",
  "datePreference",
  "maxCost",
];

const MAX_PROFILE_ITEMS = 8;
const MAX_PROFILE_ITEM_LENGTH = 80;

const INTEREST_MATCHERS = [
  [/\bartificial intelligence\b/i, "Artificial intelligence"],
  [/\bmachine learning\b/i, "Machine learning"],
  [/\bai\b/i, "AI"],
  [/\brobot(?:ics)?\b/i, "Robotics"],
  [/\bstartups?\b/i, "Startups"],
  [/\bentrepreneur(?:ship|ial)?\b/i, "Entrepreneurship"],
  [/\bhackathons?\b/i, "Hackathons"],
  [/\bcod(?:e|ing)\b/i, "Coding"],
  [/\bsoftware\b/i, "Software"],
  [/\bhardware\b/i, "Hardware"],
  [/\bnetworking\b/i, "Networking"],
  [/\bcareer\b/i, "Career"],
  [/\bproduct\b/i, "Product"],
  [/\bdesign\b/i, "Design"],
  [/\bbiotech\b/i, "Biotech"],
  [/\bclimate(?: tech)?\b/i, "Climate tech"],
  [/\bgam(?:e|es|ing)\b/i, "Gaming"],
  [/\bmusic\b/i, "Music"],
  [/\bart\b/i, "Art"],
  [/\bcreative tech\b/i, "Creative tech"],
  [/\bcommunity\b/i, "Community"],
  [/\bworkshops?\b/i, "Workshops"],
  [/\btech(?:nology)?\b/i, "Technology"],
];

const LOCATION_MATCHERS = [
  [/\bsan francisco\b|\bs\.?f\.?\b/i, "San Francisco"],
  [/\bbay area\b/i, "Bay Area"],
  [/\boakland\b/i, "Oakland"],
  [/\bberkeley\b/i, "Berkeley"],
  [/\bsan jose\b/i, "San Jose"],
  [/\bsilicon valley\b/i, "Silicon Valley"],
  [/\bpalo alto\b/i, "Palo Alto"],
  [/\bmountain view\b/i, "Mountain View"],
  [/\bredwood city\b/i, "Redwood City"],
  [/\bdaly city\b/i, "Daly City"],
  [/\beast bay\b/i, "East Bay"],
  [/\bsouth bay\b/i, "South Bay"],
  [/\bpeninsula\b/i, "Peninsula"],
  [/\bmarin\b/i, "Marin"],
  [/\bsacramento\b/i, "Sacramento"],
];

const INTAKE_COPY = {
  age: {
    question: "First, how old are you?",
    suggestions: ["I’m 16", "I’m 21", "I’m 35"],
  },
  interests: {
    question: "What topics or kinds of events are you interested in?",
    suggestions: [
      "AI and robotics",
      "Startups and networking",
      "Design and creative tech",
    ],
  },
  locations: {
    question: "Which locations or travel area should I search?",
    suggestions: [
      "San Francisco",
      "SF and Oakland",
      "Anywhere in the Bay Area",
    ],
  },
  datePreference: {
    question: "When are you available?",
    suggestions: ["This weekend", "Weeknights", "Any upcoming date"],
  },
  maxCost: {
    question: "What is the most you want to spend per event?",
    suggestions: ["Free only", "Up to $20", "Any budget"],
  },
};

function compact(value, maxLength = MAX_PROFILE_ITEM_LENGTH) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const cleaned = compact(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= MAX_PROFILE_ITEMS) break;
  }
  return result;
}

function splitList(value) {
  return unique(
    compact(value, 500)
      .replace(/\b(?:and|or)\b/gi, ",")
      .split(/[,;/|]+/)
      .map((item) =>
        item
          .replace(
            /^(?:anything (?:about|in)|events? (?:about|in)|topics? (?:like|about)|mostly|especially)\s+/i,
            "",
          )
          .replace(/[.!?]+$/g, "")
          .trim(),
      ),
  );
}

function looksLikeQuestion(value) {
  const text = compact(value, 500);
  return (
    /\?\s*$/.test(text) ||
    /^(?:what|why|how|who|when|where|which|can|could|would|should|is|are|do|does|did)\b/i.test(
      text,
    )
  );
}

function normalizeInterests(value) {
  return unique(
    normalizeList(value).map((interest) => {
      const exact = INTEREST_MATCHERS.find(([pattern]) => {
        const match = interest.match(pattern);
        return match?.[0]?.length === interest.length;
      });
      return exact ? exact[1] : interest;
    }),
  );
}

function normalizeLocations(value) {
  return unique(
    normalizeList(value).map((location) => {
      const exact = LOCATION_MATCHERS.find(([pattern]) => {
        const match = location.match(pattern);
        return match?.[0]?.length === location.length;
      });
      return exact ? exact[1] : location;
    }),
  );
}

function normalizeAge(value) {
  if (typeof value === "string" && !/^\s*\d{1,3}\s*$/.test(value)) {
    return null;
  }
  const age = Number(value);
  return Number.isInteger(age) && age >= 13 && age <= 120 ? age : null;
}

function normalizeBudget(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (
      /^(?:any|any budget|any price|no limit|unlimited)$/.test(normalized)
    ) {
      return "any";
    }
    if (/^(?:free|free only|no budget|\$?0)$/.test(normalized)) {
      return 0;
    }
    if (!/^\$?\s*\d{1,6}(?:\.\d{1,2})?$/.test(normalized)) {
      return null;
    }
  }
  const budget = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(budget) && budget >= 0 && budget <= 100_000
    ? Math.round(budget * 100) / 100
    : null;
}

function normalizeList(value) {
  if (Array.isArray(value)) return unique(value);
  if (typeof value === "string") return splitList(value);
  return [];
}

export function normalizeProfile(value = {}) {
  const raw =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const profile = {
    age: null,
    interests: "",
    locations: "",
    datePreference: "",
    maxCost: null,
  };

  const age = normalizeAge(raw.age);
  profile.age = age;

  const interests = normalizeInterests(raw.interests);
  profile.interests = interests.join(", ");

  const locations = normalizeLocations(
    raw.locations ?? raw.travelArea ?? raw.location,
  );
  profile.locations = locations.join(", ");

  profile.datePreference = compact(
    raw.datePreference ??
      raw.dateAvailability ??
      raw.availability ??
      raw.date,
    120,
  );

  const budget = normalizeBudget(
    raw.maxCost ?? raw.maxBudget ?? raw.budget,
  );
  if (raw.budgetFlexibility === "any" || budget === "any") {
    profile.budgetFlexibility = "any";
  } else if (budget !== null) {
    profile.maxCost = budget;
    profile.budgetFlexibility = "capped";
  } else if (raw.budgetFlexibility === "capped") {
    profile.budgetFlexibility = "capped";
  }

  return profile;
}

function extractAge(text) {
  const patterns = [
    /\b(?:i\s*(?:['’]\s*)?m|i\s+am|age(?: is)?|aged)\s*(?:a\s+)?(\d{1,3})(?=\b)/i,
    /\b(\d{1,3})\s*(?:years?\s*old|y\/?o|yo)\b/i,
    /\b(\d{1,3})[- ]year[- ]old\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    return normalizeAge(match[1]);
  }
  return null;
}

function explicitInterests(text) {
  const match = text.match(
    /\b(?:interested in|interests?(?: are| include|:)?|i (?:like|love|enjoy)|i(?:'m| am) into|into|looking for events? (?:about|in)|events? about)\s+(.+?)(?=(?:[,;.]\s*(?:in\s+(?:san francisco|s\.?f\.?|oakland|berkeley|san jose|silicon valley|palo alto|mountain view|redwood city|bay area|east bay|south bay|peninsula|marin|sacramento)\b|anywhere|based|located|near|around|within|i can travel|this|next|on|during|available|weekends?|weeknights?|budget|under|up to|free|any budget|\$))|[.;]|$)/i,
  );
  return match ? normalizeInterests(match[1]) : [];
}

function extractInterests(text, useWholeAnswer) {
  const explicit = explicitInterests(text);
  if (explicit.length) return explicit;

  if (looksLikeQuestion(text)) return [];

  if (/\b(?:anything|any topic|open to anything)\b/i.test(text)) {
    return ["Any topic"];
  }

  const matched = unique(
    INTEREST_MATCHERS.filter(([pattern]) => pattern.test(text)).map(
      ([, label]) => label,
    ),
  );
  if (matched.length) return matched;

  if (
    useWholeAnswer &&
    text.length <= 160 &&
    !looksLikeQuestion(text) &&
    !/^(?:hi|hello|hey|thanks?|thank you|yes|no|not sure)[.! ]*$/i.test(text)
  ) {
    return normalizeInterests(text);
  }
  return [];
}

function explicitLocations(text) {
  const match = text.match(
    /\b(?:(?:i(?:'m| am)|we(?:'re| are))\s+(?:based\s+)?in|based in|located in|anywhere in|events? in|near|around|within|(?:i|we) can travel to|willing to travel to|locations?(?: are| is|:)|travel area(?: is|:))\s+(.+?)(?=(?:[,;.]\s*(?:this|next|on|during|available|weekends?|weeknights?|budget|under|up to|free|any budget|\$))|[.;]|$)/i,
  );
  return match ? splitList(match[1]) : [];
}

function extractLocations(text, useWholeAnswer) {
  const explicit = explicitLocations(text);
  if (explicit.length) return normalizeLocations(explicit);

  if (looksLikeQuestion(text)) return [];

  const matched = unique(
    LOCATION_MATCHERS.filter(([pattern]) => pattern.test(text)).map(
      ([, label]) => label,
    ),
  );
  if (matched.length) return matched;

  if (/\b(?:nearby|near me)\b/i.test(text)) {
    return ["Nearby Bay Area"];
  }

  if (
    useWholeAnswer &&
    text.length <= 160 &&
    !looksLikeQuestion(text) &&
    !/^(?:hi|hello|hey|thanks?|thank you|yes|no|not sure)[.! ]*$/i.test(text)
  ) {
    return splitList(text);
  }
  return [];
}

function extractDateAvailability(text, useWholeAnswer) {
  const phrases = [
    [/\bthis weekend\b/i, "This weekend"],
    [/\bnext weekend\b/i, "Next weekend"],
    [/\bweekends?\b/i, "Weekends"],
    [/\bweeknights?\b|\bweekday evenings?\b|\bafter work\b/i, "Weeknights"],
    [/\bany upcoming date\b|\banytime\b|\bany date\b/i, "Any upcoming date"],
    [/\bupcoming\b|\bnext few weeks?\b/i, "Upcoming"],
    [/\btoday\b/i, "Today"],
    [/\btomorrow\b/i, "Tomorrow"],
  ];
  for (const [pattern, label] of phrases) {
    if (pattern.test(text)) return label;
  }

  const namedDate = text.match(
    /\b(?:(?:mon|tues?|wednes|thurs?|fri|satur|sun)day|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?)\b/i,
  );
  if (namedDate) return compact(namedDate[0], 120);

  const numericDate = text.match(
    /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/,
  );
  if (numericDate) return numericDate[0];

  if (
    useWholeAnswer &&
    text.length <= 120 &&
    !looksLikeQuestion(text) &&
    !/^(?:hi|hello|hey|thanks?|thank you|yes|no|not sure)[.! ]*$/i.test(text)
  ) {
    return compact(text.replace(/[.!?]+$/g, ""), 120);
  }
  return "";
}

function extractBudget(text, useWholeAnswer) {
  if (
    /\b(?:any budget|any price|price doesn['’]?t matter|budget doesn['’]?t matter|no (?:budget )?limit|unlimited budget)\b/i.test(
      text,
    )
  ) {
    return "any";
  }
  if (
    /\b(?:free(?: only)?|no[- ]cost|can['’]?t spend|cannot spend|zero budget|no budget)\b/i.test(
      text,
    )
  ) {
    return 0;
  }

  const explicit = text.match(
    /(?:\b(?:budget(?: is|:)?|under|below|up to|max(?:imum)?(?: is|:)?|less than|spend(?: up to)?)\s*)?\$\s*(\d{1,6}(?:\.\d{1,2})?)/i,
  );
  if (explicit) return normalizeBudget(explicit[1]);

  const withoutDollar = text.match(
    /\b(?:budget(?: is|:)?|under|below|up to|max(?:imum)?(?: is|:)?|less than|spend(?: up to)?)\s*(\d{1,6}(?:\.\d{1,2})?)\b/i,
  );
  if (withoutDollar) return normalizeBudget(withoutDollar[1]);

  if (useWholeAnswer) return normalizeBudget(text);
  return null;
}

function nextMissingField(profile) {
  return (
    FIELD_ORDER.find((field) => {
      if (field === "age") return profile.age === null;
      if (field === "interests" || field === "locations") {
        return !profile[field];
      }
      if (field === "datePreference") return !profile.datePreference;
      return (
        profile.maxCost === null && profile.budgetFlexibility !== "any"
      );
    }) ?? null
  );
}

function intakeMetadata(profile) {
  const nextField = nextMissingField(profile);
  const complete = nextField === null;
  return {
    complete,
    nextField,
    step: complete ? FIELD_ORDER.length : FIELD_ORDER.indexOf(nextField) + 1,
    total: FIELD_ORDER.length,
    suggestions: complete ? [] : [...INTAKE_COPY[nextField].suggestions],
  };
}

function hasExplicitProfileUpdate(text, field) {
  const patterns = {
    age: [
      /\b(?:change|update|set)\s+(?:my\s+)?age\s+(?:to|as)\b/i,
      /\b(?:i\s*(?:['’]\s*)?m|i\s+am)\s+now\s+\d{1,3}\b/i,
    ],
    interests: [
      /\b(?:change|update|replace|set)\s+(?:my\s+)?(?:interests?|topics?)\s+(?:to|as)\b/i,
      /\bmy\s+(?:new\s+)?(?:interests?|topics?)\s+(?:are|include)\b/i,
      /\b(?:i\s*(?:['’]\s*)?m|i\s+am)\s+now\s+interested\s+in\b/i,
    ],
    locations: [
      /\b(?:change|update|set)\s+(?:my\s+)?(?:location|travel area)\s+(?:to|as)\b/i,
      /\b(?:i\s+can\s+only\s+travel|search\s+only|look\s+only)\s+(?:in|near|around|to)\b/i,
      /\bmy\s+(?:location|travel area)\s+is\s+now\b/i,
    ],
    datePreference: [
      /\b(?:change|update|set)\s+(?:my\s+)?(?:availability|date preference)\s+(?:to|as)\b/i,
      /\b(?:i\s+can\s+only\s+(?:attend|go|make it)|i\s*(?:['’]\s*)?m\s+only\s+available|only\s+available)\b/i,
      /\bmy\s+availability\s+is\s+now\b/i,
    ],
    maxCost: [
      /\b(?:change|update|set)\s+(?:my\s+)?(?:budget|maximum cost)\s+(?:to|as)\b/i,
      /\bmy\s+budget\s+(?:is|is now)\b/i,
      /\b(?:i\s+can\s+(?:only\s+)?spend|free only|any budget|up to|max(?:imum)?)\b/i,
    ],
  };
  return patterns[field].some((pattern) => pattern.test(text));
}

export function collectIntake({ query, profile: inputProfile }) {
  const text = compact(query, 800);
  const profile = normalizeProfile(inputProfile);
  const initialNextField = nextMissingField(profile);
  const profileWasComplete = initialNextField === null;
  const shouldUpdate = (field) =>
    !profileWasComplete || hasExplicitProfileUpdate(text, field);

  const age = shouldUpdate("age")
    ? extractAge(text) ??
      (initialNextField === "age" ? normalizeAge(text) : null)
    : null;
  if (age !== null) profile.age = age;

  const interests = shouldUpdate("interests")
    ? extractInterests(text, initialNextField === "interests")
    : [];
  if (interests.length) profile.interests = interests.join(", ");

  const locations = shouldUpdate("locations")
    ? extractLocations(text, initialNextField === "locations")
    : [];
  if (locations.length) profile.locations = locations.join(", ");

  const dateAvailability = shouldUpdate("datePreference")
    ? extractDateAvailability(text, initialNextField === "datePreference")
    : "";
  if (dateAvailability) profile.datePreference = dateAvailability;

  const maxBudget = shouldUpdate("maxCost")
    ? extractBudget(text, initialNextField === "maxCost")
    : null;
  if (maxBudget === "any") {
    profile.maxCost = null;
    profile.budgetFlexibility = "any";
  } else if (maxBudget !== null) {
    profile.maxCost = maxBudget;
    profile.budgetFlexibility = "capped";
  }

  return {
    profile,
    intake: intakeMetadata(profile),
  };
}

export function intakeQuestion(intake) {
  const copy = INTAKE_COPY[intake.nextField];
  const needsAge = intake.nextField === "age";
  return needsAge
    ? "How old are you? Enter an age, for example “I’m 19.”"
    : copy.question;
}

function capturedFieldAcknowledgment(profile, fieldsCapturedThisTurn) {
  const latestField = fieldsCapturedThisTurn.at(-1);
  const acknowledgments = {
    age: () => `Got it — ${profile.age}.`,
    interests: () => `Nice — ${profile.interests}.`,
    locations: () => `Got it — ${profile.locations}.`,
    datePreference: () => `Perfect — ${profile.datePreference}.`,
    maxCost: () =>
      profile.budgetFlexibility === "any"
        ? "Got it — any budget."
        : `Got it — up to $${profile.maxCost}.`,
  };
  return acknowledgments[latestField]?.() ?? null;
}

export function intakeAnswer(
  profile,
  intake,
  { fieldsCapturedThisTurn = [] } = {},
) {
  const needsAge = intake.nextField === "age";
  const acknowledgment = capturedFieldAcknowledgment(
    profile,
    fieldsCapturedThisTurn,
  );
  return {
    role: "assistant",
    summary:
      acknowledgment ??
      (needsAge
        ? "I didn’t catch a valid age yet."
        : "Got it."),
    eventIds: [],
    caveat: null,
    question: intakeQuestion(intake),
    noMatch: false,
    profile,
    intake,
  };
}

export function enrichQueryWithProfile(query, profile) {
  const budget =
    profile.budgetFlexibility === "any"
      ? "any budget"
      : `$${profile.maxCost} maximum per event`;
  return [
    compact(query, 800),
    `Profile: age ${profile.age}; interests ${profile.interests}; locations/travel area ${profile.locations}; availability ${profile.datePreference}; budget ${budget}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function preferencesFromProfile(profile, preferences = {}) {
  const merged = {
    ...preferences,
    age: profile.age,
    origin: profile.locations,
    date: profile.datePreference,
    level: profile.interests,
  };
  if (profile.budgetFlexibility === "any") {
    delete merged.maxCost;
  } else {
    merged.maxCost = profile.maxCost;
  }
  return merged;
}

export const intakeFields = [...FIELD_ORDER];
