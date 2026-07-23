import {
  buildGroundedMessages,
  groundedFallback,
  groundingRecord,
  retrieveEvents,
  validateGuideAnswer,
} from "./catalog.mjs";
import {
  createProviderChain,
  ProviderError,
  streamProviderCompletion,
} from "./providers.mjs";

function safeReason(error) {
  if (error instanceof ProviderError) return error.code;
  if (error instanceof SyntaxError) return "model_output_not_json";
  if (error instanceof Error && /^model_output_/.test(error.message)) {
    return error.message;
  }
  return "provider_failed";
}

export async function runGuide({
  query,
  preferences,
  history,
  visibleEventIds,
  env = {},
  fetchImpl = fetch,
  signal,
  emit = () => {},
  now = new Date(),
}) {
  const retrievedEvents = retrieveEvents({
    query,
    preferences,
    visibleEventIds,
    now,
  });
  emit({
    type: "retrieval",
    events: retrievedEvents.map((event) => ({
      id: event.id,
      title: event.title,
      sourceUrl: event.sourceHref,
      verifiedAt: event.sourceCheckedAt,
    })),
  });

  if (!retrievedEvents.length) {
    const message = groundedFallback([], "no_match");
    emit({
      type: "answer",
      provider: "retrieval",
      providerLabel: "Verified catalog",
      model: "constraint-check",
      message,
    });
    return {
      provider: "retrieval",
      providerLabel: "Verified catalog",
      model: "constraint-check",
      message,
      attempts: [],
      sources: [],
    };
  }

  const messages = buildGroundedMessages({
    query,
    preferences,
    history,
    retrievedEvents,
  });
  const attempts = [];
  const blockedProviders = new Set();

  for (const candidate of createProviderChain(env)) {
    if (blockedProviders.has(candidate.provider)) continue;
    const startedAt = Date.now();
    emit({
      type: "attempt",
      provider: candidate.provider,
      providerLabel: candidate.providerLabel,
      model: candidate.model,
    });

    try {
      const raw = await streamProviderCompletion(candidate, {
        messages,
        env,
        fetchImpl,
        signal,
        onAlive: () =>
          emit({
            type: "alive",
            provider: candidate.provider,
            providerLabel: candidate.providerLabel,
            model: candidate.model,
          }),
      });
      const message = validateGuideAnswer(raw, retrievedEvents);
      const elapsedMs = Date.now() - startedAt;
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        status: "answered",
        elapsedMs,
      });
      emit({
        type: "answer",
        provider: candidate.provider,
        providerLabel: candidate.providerLabel,
        model: candidate.model,
        message,
      });
      return {
        provider: candidate.provider,
        providerLabel: candidate.providerLabel,
        model: candidate.model,
        message,
        attempts,
        sources: message.eventIds
          .map((id) => retrievedEvents.find((event) => event.id === id))
          .filter(Boolean)
          .map(groundingRecord),
      };
    } catch (error) {
      const reason = safeReason(error);
      const elapsedMs = Date.now() - startedAt;
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        status: "fallback",
        reason,
        elapsedMs,
      });
      if (reason === "http_401" || reason === "http_403") {
        blockedProviders.add(candidate.provider);
      }
      emit({
        type: "fallback",
        provider: candidate.provider,
        providerLabel: candidate.providerLabel,
        model: candidate.model,
        reason,
      });
      if (reason === "client_aborted") throw error;
    }
  }

  const message = groundedFallback(retrievedEvents);
  emit({
    type: "answer",
    provider: "local",
    providerLabel: "Verified catalog fallback",
    model: "retrieval-only",
    message,
  });
  return {
    provider: "local",
    providerLabel: "Verified catalog fallback",
    model: "retrieval-only",
    message,
    attempts,
    sources: message.eventIds
      .map((id) => retrievedEvents.find((event) => event.id === id))
      .filter(Boolean)
      .map(groundingRecord),
  };
}
