import {
  canonicalHttpsUrl,
  cleanText,
  costDetails,
  directEventUrl,
  formatEventLabels,
  inferCategories,
  localDateTimeToIso,
  sourceCheckLabel,
  splitTags,
  truncate,
} from "../normalize.mjs";

export const OUR415_DATASET_URL =
  "https://data.sfgov.org/resource/8i3s-ih2a.json";
export const OUR415_LANDING_URL =
  "https://data.sfgov.org/Economy-and-Community/Our415-Events-and-Activities/8i3s-ih2a";

function sourceImage(record) {
  const value =
    typeof record.event_photo === "string"
      ? record.event_photo
      : record.event_photo?.url;
  if (!value) return "/event-placeholder.svg";
  return (
    canonicalHttpsUrl(
      String(value).replace("sfpl.org//", "sfpl.org/"),
    ) || "/event-placeholder.svg"
  );
}

function sourcePlatform(record) {
  if (record.org_name === "SF Public Library") return "SFPL";
  return "Community organizer";
}

function registrationDetails(record) {
  const title = cleanText(record.event_name);
  if (/^(full|sold out)\s*:/i.test(title)) {
    return {
      registration: "Full on the source calendar",
      registrationStatus: "full",
    };
  }
  return {
    registration: "See organizer page",
    registrationStatus: "unknown",
  };
}

function addressFor(record, format) {
  if (format === "Online") return "Online";
  const address = cleanText(record.site_address);
  if (!address) return "San Francisco, CA";
  if (/san francisco|\bca\b/i.test(address)) return address;
  return `${address}, San Francisco, CA`;
}

function recordStatus(record) {
  const title = cleanText(record.event_name);
  if (/^(cancelled|canceled|postponed)\s*:/i.test(title)) return "cancelled";
  if (/^(full|sold out)\s*:/i.test(title)) return "full";
  return "scheduled";
}

export function normalizeOur415Record(record, { checkedAt }) {
  const sourceHref = directEventUrl(record.more_info);
  if (!sourceHref) return null;
  if (!record.id || !record.event_name || !record.event_start_date) {
    return null;
  }
  if (recordStatus(record) !== "scheduled") return null;

  const dateKey = String(record.event_start_date).slice(0, 10);
  const endDateKey =
    String(record.event_end_date || record.event_start_date).slice(0, 10) ||
    dateKey;
  const hasStartTime = Boolean(record.start_time);
  const hasEndTime = Boolean(record.end_time);
  const startTime = record.start_time || "00:00:00";
  const endTime = record.end_time || (hasStartTime ? "23:59:00" : "23:59:00");
  const startAt = localDateTimeToIso(dateKey, startTime);
  let endAt = localDateTimeToIso(endDateKey, endTime);
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    endAt = new Date(Date.parse(startAt) + 60 * 60 * 1000).toISOString();
  }

  const description = truncate(record.event_description, 420);
  const ageTags = splitTags(record.age_group_eligibility_tags);
  const languageTags = splitTags(record.language_eligibility_tags);
  const sourceCategory = cleanText(record.events_category);
  const categories = inferCategories(
    record.event_name,
    description,
    sourceCategory,
  );
  const tags = [
    ...new Set(
      [
        sourceCategory,
        ...ageTags,
        ...languageTags,
        cleanText(record.org_name),
      ].filter(Boolean),
    ),
  ].slice(0, 12);
  const format =
    /\b(online|virtual|zoom)\b/i.test(
      `${record.site_location_name || ""} ${description}`,
    ) ? "Online" : "In person";
  const { cost, costLabel } = costDetails({
    fee: record.fee,
    admissionPrice: record.admission_price,
    description,
  });
  const { registration, registrationStatus } =
    registrationDetails(record);
  const labels = formatEventLabels(startAt, endAt, {
    endTimePublished: hasEndTime,
    allDay: !hasStartTime,
  });
  const platform = sourcePlatform(record);
  const audienceLabel = ageTags.length
    ? `${ageTags.slice(0, 2).join(" · ")} · source hint`
    : "Audience not published";
  const unknowns = [
    "Our415 audience tags are discovery hints and may be machine-assigned; confirm admission details on the organizer page.",
  ];
  if (cost === null) {
    unknowns.push("The source feed does not publish an exact price.");
  }
  if (!hasEndTime) {
    unknowns.push("The source feed does not publish an end time.");
  }

  return {
    id: `our415-${String(record.id).replace(/[^a-z0-9_-]+/gi, "-")}`,
    title: cleanText(record.event_name),
    shortTitle: truncate(record.event_name, 62),
    startAt,
    endAt,
    ...labels,
    neighborhood:
      cleanText(record.analysis_neighborhood) ||
      cleanText(record.site_location_name) ||
      "San Francisco",
    venue:
      cleanText(record.site_location_name) ||
      (format === "Online" ? `${platform} online` : cleanText(record.org_name)),
    address: addressFor(record, format),
    latitude: record.latitude ? Number(record.latitude) : null,
    longitude: record.longitude ? Number(record.longitude) : null,
    categories,
    tags,
    ageTags,
    audienceLabel,
    cost,
    costLabel,
    eligibility: "unknown",
    eligibilityLabel: "Age policy not independently confirmed",
    format,
    registration,
    registrationStatus,
    source: `DataSF · ${cleanText(record.org_name)}`,
    sourceId: String(record.id),
    sourcePlatform: platform,
    sourceHref,
    sourceDataset: "DataSF Our415 · daily open data",
    sourceDatasetHref: OUR415_LANDING_URL,
    sourceType: "open-data",
    sourceDataAt:
      record.data_as_of || record.data_loaded_at || checkedAt,
    sourceCheckedAt: checkedAt,
    checked: sourceCheckLabel(checkedAt),
    verificationStatus: "verified",
    eventStatus: "scheduled",
    image: sourceImage(record),
    imageAlt: `Source image for ${cleanText(record.event_name)}.`,
    matchLabel: `${cleanText(record.org_name)} · current listing`,
    matchReason:
      "A current public or community listing from San Francisco’s daily Our415 open dataset.",
    description:
      description ||
      `See the organizer page for details about ${cleanText(record.event_name)}.`,
    confidence:
      "Schedule and logistics came from the City’s daily Our415 dataset; the linked organizer page is the final authority.",
    unknowns,
  };
}

export async function fetchOur415Events({
  now = new Date(),
  horizonDays = 35,
  appToken,
  fetchImpl = fetch,
  signal,
  checkedAt = new Date().toISOString(),
} = {}) {
  const startDate = now.toISOString().slice(0, 10);
  const horizonDate = new Date(
    now.getTime() + horizonDays * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const url = new URL(OUR415_DATASET_URL);
  url.searchParams.set("$limit", "5000");
  url.searchParams.set(
    "$where",
    [
      `event_end_date >= '${startDate}T00:00:00'`,
      `event_start_date <= '${horizonDate}T23:59:59'`,
      "org_name != 'SF Rec Park'",
      "more_info IS NOT NULL",
    ].join(" AND "),
  );
  url.searchParams.set("$order", "event_start_date,start_time");

  const headers = {
    Accept: "application/json",
    "User-Agent": "FindrCatalogSync/1.0 (+https://github.com/Srikamarthapu/Findr)",
  };
  if (appToken) headers["X-App-Token"] = appToken;

  const response = await fetchImpl(url, { headers, signal });
  if (!response.ok) {
    throw new Error(`Our415 request failed with HTTP ${response.status}.`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error("Our415 returned an invalid payload.");
  }

  return rows
    .map((record) => normalizeOur415Record(record, { checkedAt }))
    .filter(Boolean)
    .filter((event) => Date.parse(event.endAt) > now.getTime())
    .filter(
      (event) =>
        Date.parse(event.startAt) <=
        now.getTime() + horizonDays * 86_400_000,
    );
}
