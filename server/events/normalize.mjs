const DEFAULT_TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 86_400_000;

const namedEntities = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  "#8211": "–",
  "#8212": "—",
  "#8216": "‘",
  "#8217": "’",
  "#8220": "“",
  "#8221": "”",
};

export function decodeEntities(value = "") {
  return String(value).replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (match, entity) => {
      const normalized = entity.toLowerCase();
      if (namedEntities[normalized]) return namedEntities[normalized];
      if (normalized.startsWith("#x")) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }
      if (normalized.startsWith("#")) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }
      return match;
    },
  );
}

export function cleanText(value = "") {
  return decodeEntities(
    String(value)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<li[^>]*>/gi, " • ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(value, length = 280) {
  const normalized = cleanText(value);
  if (normalized.length <= length) return normalized;
  const clipped = normalized.slice(0, length - 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > length * 0.65 ? boundary : -1)}…`;
}

export function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function canonicalHttpsUrl(value, base) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim(), base);
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function sourceCheckLabel(value) {
  return `synced ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: DEFAULT_TIME_ZONE,
  }).format(new Date(value))}`;
}

function partsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

export function localDateTimeToIso(
  dateKey,
  time = "00:00:00",
  timeZone = DEFAULT_TIME_ZONE,
) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = String(time)
    .split(":")
    .map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;

  for (let index = 0; index < 3; index += 1) {
    const local = partsInTimeZone(new Date(guess), timeZone);
    const represented = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    const delta = target - represented;
    guess += delta;
    if (delta === 0) break;
  }

  return new Date(guess).toISOString();
}

export function formatEventLabels(
  startAt,
  endAt,
  {
    timeZone = DEFAULT_TIME_ZONE,
    endTimePublished = true,
    allDay = false,
  } = {},
) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(start);
  const dateLong = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(start);
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

  let time = "All day";
  if (!allDay) {
    const startLabel = timeFormatter.format(start);
    time = endTimePublished
      ? `${startLabel}–${timeFormatter.format(end)}`
      : `Starts ${startLabel} · end not published`;
  }

  return { dateLabel, dateLong, time };
}

export function costDetails({ fee, admissionPrice, description = "" }) {
  const priceText = cleanText(admissionPrice);
  const descriptionText = cleanText(description);
  if (
    fee === false ||
    String(fee).toLowerCase() === "false" ||
    /\bfree\b/i.test(priceText)
  ) {
    return { cost: 0, costLabel: "Free" };
  }

  const priceMatch = priceText.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (priceMatch) {
    const cost = Number(priceMatch[1]);
    return {
      cost,
      costLabel: Number.isInteger(cost)
        ? `$${cost}`
        : `$${cost.toFixed(2)}`,
    };
  }

  if (fee === true || String(fee).toLowerCase() === "true") {
    return { cost: null, costLabel: "Fee · price not published" };
  }
  if (/\bfree\b/i.test(descriptionText)) {
    return { cost: 0, costLabel: "Free" };
  }
  return { cost: null, costLabel: "Cost not published" };
}

export function inferCategories(...values) {
  const text = cleanText(values.flat().filter(Boolean).join(" ")).toLowerCase();
  const categories = new Set();

  if (
    /\b(ai|api|coding|computer|developer|engineering|hackathon|maker|robot|science|steam|stem|tech|technology)\b/.test(
      text,
    )
  ) {
    categories.add("Tech");
  }
  if (
    /\b(ai|artificial intelligence|founder|fundraising|gtm|hackathon|investor|llm|machine learning|mcp|pitch|saas|startup|venture|vc|yc)\b/.test(
      text,
    )
  ) {
    categories.add("AI & Startups");
  }
  if (
    /\b(business|career|entrepreneur|interview|job|networking|professional|resume|workforce)\b/.test(
      text,
    )
  ) {
    categories.add("Career");
  }
  if (
    /\b(art|author|book|craft|creative|crochet|dance|design|film|knit|music|paint|performance|photo|poetry|sew|theater|theatre|writing)\b/.test(
      text,
    )
  ) {
    categories.add("Creative");
  }
  if (
    /\b(civic|club|community|family|festival|fitness|game|garden|health|language|outdoor|parent|play|social|sport|storytime|support|volunteer|wellness|workshop|yoga)\b/.test(
      text,
    )
  ) {
    categories.add("Community");
  }

  if (categories.size === 0) categories.add("Community");
  return [...categories];
}

export function splitTags(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(cleanText).filter(Boolean))];
  }
  return [
    ...new Set(
      cleanText(value)
        .split(/\s*;\s*|\s*,\s*/)
        .map(cleanText)
        .filter(Boolean),
    ),
  ];
}

export function nextDateKey(dateKey, days = 1) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function dateKeysBetween(startDateKey, endDateKey) {
  const dates = [];
  for (
    let dateKey = startDateKey;
    dateKey <= endDateKey;
    dateKey = nextDateKey(dateKey)
  ) {
    dates.push(dateKey);
  }
  return dates;
}

export function directEventUrl(value) {
  const url = canonicalHttpsUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/+$/, "");
  if (!path || path === "/") return null;
  if (
    parsed.hostname.endsWith("sfrecpark.org") &&
    /^\/register$/i.test(path)
  ) {
    return null;
  }
  return url;
}
