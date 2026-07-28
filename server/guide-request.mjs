const utf8Encoder = new TextEncoder();

export function utf8ByteLength(value) {
  return utf8Encoder.encode(String(value)).byteLength;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedJsonObject(value, maxBytes) {
  return (
    isRecord(value) &&
    utf8ByteLength(JSON.stringify(value)) <= maxBytes
  );
}

function validStringList(value, { maxItems, maxLength }) {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every(
      (item) => typeof item === "string" && item.length <= maxLength,
    )
  );
}

function validProfile(profile) {
  if (profile === undefined) return true;
  if (!boundedJsonObject(profile, 3_000)) return false;

  const age = profile.age;
  if (
    age !== undefined &&
    age !== null &&
    !(typeof age === "number" && Number.isFinite(age))
  ) {
    return false;
  }

  for (const key of ["interests", "locations"]) {
    if (
      profile[key] !== undefined &&
      (typeof profile[key] !== "string" || profile[key].length > 640)
    ) {
      return false;
    }
  }

  if (
    profile.datePreference !== undefined &&
    (typeof profile.datePreference !== "string" ||
      profile.datePreference.length > 160)
  ) {
    return false;
  }

  if (
    profile.maxCost !== undefined &&
    profile.maxCost !== null &&
    !(typeof profile.maxCost === "number" && Number.isFinite(profile.maxCost))
  ) {
    return false;
  }

  if (
    profile.budgetFlexibility !== undefined &&
    !["capped", "any"].includes(profile.budgetFlexibility)
  ) {
    return false;
  }
  return true;
}

export function validateGuideRequest(value) {
  if (
    !isRecord(value) ||
    typeof value.query !== "string" ||
    value.query.trim().length < 1 ||
    value.query.length > 800 ||
    !validProfile(value.profile)
  ) {
    return false;
  }

  if (
    value.preferences !== undefined &&
    !boundedJsonObject(value.preferences, 3_000)
  ) {
    return false;
  }

  if (
    value.history !== undefined &&
    !(
      Array.isArray(value.history) &&
      value.history.length <= 8 &&
      value.history.every(
        (message) =>
          isRecord(message) &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string" &&
          message.content.length <= 1_500 &&
          (message.eventIds === undefined ||
            (message.role === "assistant" &&
              validStringList(message.eventIds, {
                maxItems: 4,
                maxLength: 160,
              }))),
      )
    )
  ) {
    return false;
  }

  if (
    value.visibleEventIds !== undefined &&
    !validStringList(value.visibleEventIds, {
      maxItems: 100,
      maxLength: 160,
    })
  ) {
    return false;
  }
  return true;
}
