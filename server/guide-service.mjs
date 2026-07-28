import {
  buildConversationMessages,
  buildGroundedMessages,
  conversationalFallback,
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
import {
  collectIntake,
  enrichQueryWithProfile,
  intakeAnswer,
  intakeQuestion,
  preferencesFromProfile,
} from "./intake.mjs";

function safeReason(error) {
  if (error instanceof ProviderError) return error.code;
  if (error instanceof SyntaxError) return "model_output_not_json";
  if (error instanceof Error && /^model_output_/.test(error.message)) {
    return error.message;
  }
  return "provider_failed";
}

function previousRecommendedEventIds(history) {
  if (!Array.isArray(history)) return [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (
      message?.role === "assistant" &&
      Array.isArray(message.eventIds) &&
      message.eventIds.length
    ) {
      return [
        ...new Set(
          message.eventIds
            .filter((id) => typeof id === "string" && id)
            .slice(0, 4),
        ),
      ];
    }
  }
  return [];
}

function isReferentialFollowUp(query) {
  const normalized = String(query).toLowerCase();
  if (
    /\b(?:more|others?|another)\s+(?:events?\s+)?(?:like\s+)?(?:those|these|them)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  return (
    /\b(?:which|what)\s+(?:one\s+)?(?:of\s+)?(?:those|these|them)\b/.test(
      normalized,
    ) ||
    /\b(?:of those|of these|between them|between those)\b/.test(normalized) ||
    /\b(?:the\s+)?(?:first|second|third|fourth|last|former|latter)\s+(?:one|event|option)\b/.test(
      normalized,
    ) ||
    /\bwhich\s+(?:one|event|option)\s+should\s+i\s+(?:choose|pick|attend)\b/.test(
      normalized,
    )
  );
}

function isEventDiscoveryRequest(query, history) {
  const normalized = String(query).toLowerCase();
  const priorEventIds = previousRecommendedEventIds(history);
  if (priorEventIds.length && isReferentialFollowUp(normalized)) return true;
  if (
    /^(?:what\s+(?:is|are|does)|why\s+(?:is|are|do|does)|how\s+(?:is|are|do|does|can)|who\s+(?:is|are)|explain\b|tell me about\b)/.test(
      normalized,
    ) &&
    !/\b(?:find|show|recommend|suggest|compare|attend|register|best|good|upcoming|nearby)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  if (
    /\b(events?|meetups?|workshops?|hackathons?|conferences?|talks?|demo nights?|things? to do)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    /\b(?:find|show|recommend|suggest|compare|attend|register|registration)\b.{0,50}\b(?:weekend|weeknight|tonight|tomorrow|nearby|free|under|around|in)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    /\b(?:source link|luma|organizer|which one should i|what can i do)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    priorEventIds.length &&
    /\b(?:which|choose|pick|closest|cheapest|free|price|cost|time|date|location|hands-on|technical|networking|builder|after work|weeknights?|weekends?)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    /\b(?:my\s+)?(?:interests?|location|travel area|availability|budget)\b/.test(
      normalized,
    ) ||
    /\b(?:this|next)\s+weekend\b|\b(?:tonight|tomorrow|after work|weeknights?|weekends?|free only|any budget|up to\s+\$\d+)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  const topicPattern =
    /\b(?:ai|artificial intelligence|startups?|founders?|hackathons?|robotics?|coding|developer|design|creative tech|biotech|climate tech|gaming|music|art|career|networking|product|community|hands-on)\b/;
  if (
    topicPattern.test(normalized) &&
    /\b(?:i like|i love|i want|i prefer|interested in|looking for|find me|show me)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount <= 8 && topicPattern.test(normalized);
}

async function runProviderCascade({
  messages,
  validate,
  env,
  fetchImpl,
  signal,
  emit,
  providerChainImpl,
  providerCompletionImpl,
}) {
  const attempts = [];
  const blockedProviders = new Set();

  for (const candidate of providerChainImpl(env)) {
    if (blockedProviders.has(candidate.provider)) continue;
    const startedAt = Date.now();
    emit({
      type: "attempt",
      provider: candidate.provider,
      providerLabel: candidate.providerLabel,
      model: candidate.model,
    });

    try {
      const raw = await providerCompletionImpl(candidate, {
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
      const message = validate(raw);
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        status: "answered",
        elapsedMs: Date.now() - startedAt,
      });
      return {
        provider: candidate.provider,
        providerLabel: candidate.providerLabel,
        model: candidate.model,
        message,
        attempts,
      };
    } catch (error) {
      const reason = safeReason(error);
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        status: "fallback",
        reason,
        elapsedMs: Date.now() - startedAt,
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

  return { attempts };
}

function emitAnswer(emit, result, profile, intake) {
  emit({
    type: "answer",
    provider: result.provider,
    providerLabel: result.providerLabel,
    model: result.model,
    message: result.message,
    profile,
    intake,
  });
}

function validateConversationAnswer(raw, requiredQuestion = null) {
  const message = validateGuideAnswer(raw, []);
  if (
    /\b(?:the user|user (?:asked|said|greeted|wants|needs))\b/i.test(
      `${message.summary} ${message.caveat ?? ""} ${message.question}`,
    )
  ) {
    throw new Error("model_output_not_direct");
  }
  return {
    ...message,
    eventIds: [],
    noMatch: false,
    ...(requiredQuestion ? { question: requiredQuestion } : {}),
  };
}

export async function runGuide({
  query,
  profile,
  preferences,
  history,
  visibleEventIds,
  env = {},
  fetchImpl = fetch,
  signal,
  emit = () => {},
  now = new Date(),
  retrieveImpl = retrieveEvents,
  providerChainImpl = createProviderChain,
  providerCompletionImpl = streamProviderCompletion,
}) {
  const profileWasComplete = collectIntake({
    query: "",
    profile,
  }).intake.complete;
  const intakeState = collectIntake({ query, profile });
  if (!intakeState.intake.complete) {
    const requiredQuestion = intakeQuestion(intakeState.intake);
    const messages = buildConversationMessages({
      query,
      history,
      profile: intakeState.profile,
      intake: intakeState.intake,
      requiredQuestion,
    });
    const live = await runProviderCascade({
      messages,
      validate: (raw) => validateConversationAnswer(raw, requiredQuestion),
      env,
      fetchImpl,
      signal,
      emit,
      providerChainImpl,
      providerCompletionImpl,
    });
    const result = live.message
      ? live
      : {
          provider: "intake",
          providerLabel: "Findr profile intake",
          model: "deterministic",
          message: intakeAnswer(intakeState.profile, intakeState.intake),
          attempts: live.attempts,
        };
    emitAnswer(emit, result, intakeState.profile, intakeState.intake);
    return {
      ...result,
      profile: intakeState.profile,
      intake: intakeState.intake,
      sources: [],
    };
  }

  emit({
    type: "intake",
    profile: intakeState.profile,
    intake: intakeState.intake,
  });

  if (profileWasComplete && !isEventDiscoveryRequest(query, history)) {
    const messages = buildConversationMessages({
      query,
      history,
      profile: intakeState.profile,
      intake: intakeState.intake,
    });
    const live = await runProviderCascade({
      messages,
      validate: (raw) => validateConversationAnswer(raw),
      env,
      fetchImpl,
      signal,
      emit,
      providerChainImpl,
      providerCompletionImpl,
    });
    const result = live.message
      ? live
      : {
          provider: "local",
          providerLabel: "Findr conversation fallback",
          model: "conversation-fallback",
          message: conversationalFallback({
            intake: intakeState.intake,
          }),
          attempts: live.attempts,
        };
    emitAnswer(emit, result, intakeState.profile, intakeState.intake);
    return {
      ...result,
      profile: intakeState.profile,
      intake: intakeState.intake,
      sources: [],
    };
  }

  const enrichedQuery = enrichQueryWithProfile(query, intakeState.profile);
  const retrievalPreferences = preferencesFromProfile(
    intakeState.profile,
    preferences,
  );
  const priorEventIds = previousRecommendedEventIds(history);
  const referentialScope =
    priorEventIds.length && isReferentialFollowUp(query)
      ? priorEventIds
      : visibleEventIds;
  const retrievedEvents = retrieveImpl({
    query: enrichedQuery,
    preferences: retrievalPreferences,
    visibleEventIds: referentialScope,
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
      profile: intakeState.profile,
      intake: intakeState.intake,
      attempts: [],
      sources: [],
    };
  }

  const messages = buildGroundedMessages({
    query: enrichedQuery,
    preferences: retrievalPreferences,
    history,
    retrievedEvents,
  });
  const live = await runProviderCascade({
    messages,
    validate: (raw) => validateGuideAnswer(raw, retrievedEvents),
    env,
    fetchImpl,
    signal,
    emit,
    providerChainImpl,
    providerCompletionImpl,
  });
  if (live.message) {
    emitAnswer(emit, live, intakeState.profile, intakeState.intake);
    return {
      ...live,
      profile: intakeState.profile,
      intake: intakeState.intake,
      sources: live.message.eventIds
        .map((id) => retrievedEvents.find((event) => event.id === id))
        .filter(Boolean)
        .map(groundingRecord),
    };
  }

  const message = groundedFallback(retrievedEvents);
  const result = {
    provider: "local",
    providerLabel: "Verified catalog fallback",
    model: "retrieval-only",
    message,
    attempts: live.attempts,
  };
  emitAnswer(emit, result, intakeState.profile, intakeState.intake);
  return {
    ...result,
    profile: intakeState.profile,
    intake: intakeState.intake,
    sources: message.eventIds
      .map((id) => retrievedEvents.find((event) => event.id === id))
      .filter(Boolean)
      .map(groundingRecord),
  };
}
