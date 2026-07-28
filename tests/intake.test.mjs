import assert from "node:assert/strict";
import test from "node:test";
import { retrieveEvents } from "../server/catalog.mjs";
import { runGuide } from "../server/guide-service.mjs";
import { collectIntake } from "../server/intake.mjs";
import { validateGuideRequest } from "../server/vite-guide-plugin.mjs";

const now = new Date("2026-07-28T12:00:00-07:00");
const emptyProfile = {
  age: null,
  interests: "",
  locations: "",
  datePreference: "",
  maxCost: null,
};

test("Hello gets a live conversational reply, asks for age, and never retrieves", async () => {
  let retrievalCalls = 0;
  let providerChainCalls = 0;
  let providerCompletionCalls = 0;
  const emitted = [];

  const result = await runGuide({
    query: "Hello!",
    profile: emptyProfile,
    preferences: {
      age: 16,
      origin: "Mission",
      date: "This weekend",
      maxCost: 20,
    },
    retrieveImpl: () => {
      retrievalCalls += 1;
      return [];
    },
    providerChainImpl: () => {
      providerChainCalls += 1;
      return [
        {
          provider: "test",
          providerLabel: "Test provider",
          model: "conversation-model",
        },
      ];
    },
    providerCompletionImpl: async (_candidate, { messages, onAlive }) => {
      providerCompletionCalls += 1;
      assert.match(messages[0].content, /do not retrieve/i);
      onAlive();
      return JSON.stringify({
        summary: "Hi! I’d be happy to learn what kind of outing fits you.",
        eventIds: [],
        caveat: null,
        question: "This provider wording is intentionally replaced.",
      });
    },
    emit: (event) => emitted.push(event),
  });

  assert.equal(result.provider, "test");
  assert.deepEqual(result.message.eventIds, []);
  assert.equal(result.intake.complete, false);
  assert.equal(result.intake.nextField, "age");
  assert.equal(result.intake.step, 1);
  assert.equal(result.intake.total, 5);
  assert.match(result.message.question, /how old|age/i);
  assert.match(result.message.summary, /happy to learn/i);
  assert.deepEqual(result.profile, emptyProfile);
  assert.equal(retrievalCalls, 0);
  assert.equal(providerChainCalls, 1);
  assert.equal(providerCompletionCalls, 1);
  assert.deepEqual(emitted.map((event) => event.type), [
    "attempt",
    "alive",
    "answer",
  ]);
});

test("natural age variants advance to interests without recommendations", async () => {
  const variants = [
    "Im 16",
    "I'm 16",
    "I’m 16",
    "I am 16",
    "i m 16",
    "im16",
  ];

  for (const query of variants) {
    let retrievalCalls = 0;
    const result = await runGuide({
      query,
      profile: emptyProfile,
      retrieveImpl: () => {
        retrievalCalls += 1;
        return [];
      },
    });

    assert.equal(result.provider, "intake", query);
    assert.equal(result.profile.age, 16, query);
    assert.equal(result.intake.nextField, "interests", query);
    assert.equal(result.intake.step, 2, query);
    assert.deepEqual(result.message.eventIds, [], query);
    assert.equal(retrievalCalls, 0, query);
  }
});

test("an invalid age gets a brief correction and remains bounded", async () => {
  const result = await runGuide({
    query: "I am 12",
    profile: emptyProfile,
    retrieveImpl: () => {
      throw new Error("retrieval must not run for an invalid age");
    },
  });

  assert.equal(result.intake.nextField, "age");
  assert.equal(result.profile.age, null);
  assert.deepEqual(result.message.eventIds, []);
  assert.match(result.message.summary, /didn.t catch a valid age/i);
  assert.match(result.message.question, /13 to 120/);
  assert.doesNotMatch(result.message.summary, /five quick questions/i);
});

test("multi-turn intake never recommends before all five fields exist", async () => {
  const turns = [
    ["Hello", "age"],
    ["16", "interests"],
    ["AI and robotics", "locations"],
    ["SF or Oakland", "datePreference"],
    ["This weekend", "maxCost"],
  ];
  let profile = emptyProfile;
  let retrievalCalls = 0;

  for (const [query, nextField] of turns) {
    const result = await runGuide({
      query,
      profile,
      now,
      retrieveImpl: () => {
        retrievalCalls += 1;
        return [];
      },
    });

    assert.equal(result.provider, "intake");
    assert.deepEqual(result.message.eventIds, []);
    assert.equal(result.intake.complete, false);
    assert.equal(result.intake.nextField, nextField);
    assert.ok(result.intake.suggestions.length > 0);
    profile = result.profile;
  }

  assert.deepEqual(profile, {
    age: 16,
    interests: "AI, Robotics",
    locations: "San Francisco, Oakland",
    datePreference: "This weekend",
    maxCost: null,
  });
  assert.equal(retrievalCalls, 0);
});

test("a general question during intake is answered before asking the next field", async () => {
  let retrievalCalls = 0;
  const result = await runGuide({
    query: "What is a hackathon?",
    profile: {
      ...emptyProfile,
      age: 21,
    },
    retrieveImpl: () => {
      retrievalCalls += 1;
      return [];
    },
    providerChainImpl: () => [
      {
        provider: "test",
        providerLabel: "Test provider",
        model: "conversation-model",
      },
    ],
    providerCompletionImpl: async () =>
      JSON.stringify({
        summary:
          "A hackathon is a focused event where people collaborate to build and present a project.",
        eventIds: [],
        caveat: null,
        question: "Ignored provider question",
      }),
  });

  assert.equal(retrievalCalls, 0);
  assert.equal(result.provider, "test");
  assert.match(result.message.summary, /collaborate to build/i);
  assert.match(result.message.question, /topics|interested/i);
  assert.deepEqual(result.message.eventIds, []);
  assert.equal(result.intake.nextField, "interests");
});

test("collects a natural multi-field one-shot profile", () => {
  const result = collectIntake({
    query:
      "I'm 16, interested in AI and robotics, anywhere in SF or Oakland, this weekend, up to $20.",
    profile: {},
  });

  assert.equal(result.intake.complete, true);
  assert.deepEqual(result.profile, {
    age: 16,
    interests: "AI, Robotics",
    locations: "San Francisco, Oakland",
    datePreference: "This weekend",
    maxCost: 20,
    budgetFlexibility: "capped",
  });
});

test("one-shot profile keeps named locations out of the interest field", () => {
  const result = collectIntake({
    query:
      "I am 25, interested in AI research, developer tools, and startup demos, in San Francisco or Palo Alto, available on any upcoming weeknight, with any budget.",
    profile: {},
  });

  assert.equal(result.intake.complete, true);
  assert.equal(
    result.profile.interests,
    "AI research, developer tools, startup demos",
  );
  assert.equal(result.profile.locations, "San Francisco, Palo Alto");
  assert.equal(result.profile.datePreference, "Weeknights");
  assert.equal(result.profile.budgetFlexibility, "any");
});

test("collecting the final budget enables retrieval in the same request", async () => {
  let retrievalCalls = 0;
  let retrievedQuery = "";
  let retrievedPreferences;
  let providerChainCalls = 0;

  const result = await runGuide({
    query: "Up to $20",
    profile: {
      age: 16,
      interests: "AI, Hackathons",
      locations: "San Francisco, Bay Area",
      datePreference: "This weekend",
      maxCost: null,
    },
    now,
    retrieveImpl: (options) => {
      retrievalCalls += 1;
      retrievedQuery = options.query;
      retrievedPreferences = options.preferences;
      return retrieveEvents(options);
    },
    providerChainImpl: () => {
      providerChainCalls += 1;
      return [];
    },
  });

  assert.equal(retrievalCalls, 1);
  assert.equal(providerChainCalls, 1);
  assert.equal(result.intake.complete, true);
  assert.equal(result.profile.maxCost, 20);
  assert.equal(result.profile.budgetFlexibility, "capped");
  assert.match(retrievedQuery, /age 16/i);
  assert.match(retrievedQuery, /AI, Hackathons/i);
  assert.match(retrievedQuery, /San Francisco, Bay Area/i);
  assert.match(retrievedQuery, /This weekend/i);
  assert.match(retrievedQuery, /\$20 maximum/i);
  assert.equal(retrievedPreferences.maxCost, 20);
  assert.equal(result.provider, "local");
  assert.ok(result.message.eventIds.length > 0);
});

test("age bounds and budget variants stay deterministic", () => {
  const tooYoung = collectIntake({ query: "I am 12", profile: {} });
  assert.equal(tooYoung.intake.nextField, "age");

  const oldestAllowed = collectIntake({
    query:
      "I am 120, into design, in Berkeley, weeknights, and any budget.",
    profile: {},
  });
  assert.equal(oldestAllowed.profile.age, 120);
  assert.equal(oldestAllowed.profile.maxCost, null);
  assert.equal(oldestAllowed.profile.budgetFlexibility, "any");
  assert.equal(oldestAllowed.intake.complete, true);

  const free = collectIntake({
    query: "Free only",
    profile: {
      age: 21,
      interests: "Startups",
      locations: "Bay Area",
      datePreference: "Upcoming",
      maxCost: null,
    },
  });
  assert.equal(free.profile.maxCost, 0);
  assert.equal(free.profile.budgetFlexibility, "capped");
  assert.equal(free.intake.complete, true);
});

test("completed profiles ignore incidental mentions but accept explicit updates", () => {
  const profile = {
    age: 25,
    interests: "AI, Startups, Hackathons, Networking",
    locations: "San Francisco, Bay Area",
    datePreference: "Any upcoming date",
    maxCost: null,
    budgetFlexibility: "any",
  };
  const result = collectIntake({
    query:
      "I care much more about building something hands-on than networking, and I can only attend after work.",
    profile,
  });

  assert.equal(result.profile.interests, profile.interests);
  assert.equal(result.profile.locations, profile.locations);
  assert.equal(result.profile.datePreference, "Weeknights");
  assert.equal(result.profile.budgetFlexibility, "any");

  const explicit = collectIntake({
    query: "Change my interests to design and creative tech.",
    profile,
  });
  assert.match(explicit.profile.interests, /Design/i);
  assert.match(explicit.profile.interests, /Creative tech/i);
});

test("an obvious general question after intake stays conversational and skips retrieval", async () => {
  let retrievalCalls = 0;
  const profile = {
    age: 25,
    interests: "AI, Startups",
    locations: "Bay Area",
    datePreference: "Any upcoming date",
    maxCost: null,
    budgetFlexibility: "any",
  };
  const result = await runGuide({
    query: "Why is the sky blue?",
    profile,
    retrieveImpl: () => {
      retrievalCalls += 1;
      return [];
    },
    providerChainImpl: () => [
      {
        provider: "test",
        providerLabel: "Test provider",
        model: "conversation-model",
      },
    ],
    providerCompletionImpl: async () =>
      JSON.stringify({
        summary:
          "Air molecules scatter shorter blue wavelengths more than red ones.",
        eventIds: [],
        caveat: null,
        question: "Want to return to finding events?",
      }),
  });

  assert.equal(retrievalCalls, 0);
  assert.equal(result.provider, "test");
  assert.deepEqual(result.profile, profile);
  assert.deepEqual(result.message.eventIds, []);
  assert.match(result.message.summary, /blue wavelengths/i);
});

test("an unrelated statement after intake stays conversational and skips retrieval", async () => {
  let retrievalCalls = 0;
  const profile = {
    age: 25,
    interests: "AI, Startups",
    locations: "Bay Area",
    datePreference: "Any upcoming date",
    maxCost: null,
    budgetFlexibility: "any",
  };
  const result = await runGuide({
    query: "I had a rough day.",
    profile,
    retrieveImpl: () => {
      retrievalCalls += 1;
      return [];
    },
    providerChainImpl: () => [
      {
        provider: "test",
        providerLabel: "Test provider",
        model: "conversation-model",
      },
    ],
    providerCompletionImpl: async () =>
      JSON.stringify({
        summary: "I’m sorry today was rough. I’m here with you.",
        eventIds: [],
        caveat: null,
        question: "Want to talk for a moment or return to event discovery?",
      }),
  });

  assert.equal(retrievalCalls, 0);
  assert.equal(result.provider, "test");
  assert.deepEqual(result.message.eventIds, []);
  assert.match(result.message.summary, /sorry today was rough/i);
});

test("referential follow-ups retrieve only the previously recommended events", async () => {
  const profile = {
    age: 25,
    interests: "AI, Startups",
    locations: "Bay Area",
    datePreference: "Any upcoming date",
    maxCost: null,
    budgetFlexibility: "any",
  };
  const priorEvents = retrieveEvents({
    query: "AI startup events",
    preferences: {
      age: profile.age,
      origin: profile.locations,
      date: profile.datePreference,
      level: profile.interests,
    },
    now,
    limit: 3,
  });
  assert.ok(priorEvents.length >= 2);
  const priorIds = priorEvents.map((event) => event.id);
  let retrievalScope;

  const result = await runGuide({
    query: "Which of those is the most hands-on?",
    profile,
    history: [
      {
        role: "assistant",
        content: "These are the strongest matches.",
        eventIds: priorIds,
      },
    ],
    visibleEventIds: ["unrelated-visible-event"],
    now,
    retrieveImpl: (options) => {
      retrievalScope = options.visibleEventIds;
      return retrieveEvents(options);
    },
    providerChainImpl: () => [],
  });

  assert.deepEqual(retrievalScope, priorIds);
  assert.ok(result.message.eventIds.length > 0);
  assert.ok(result.message.eventIds.every((id) => priorIds.includes(id)));
});

test("request validation accepts bounded partial profiles and rejects excess", () => {
  assert.equal(
    validateGuideRequest({
      query: "Hello",
      profile: {
        ...emptyProfile,
      },
      history: [{ role: "user", content: "Hello" }],
    }),
    true,
  );
  assert.equal(
    validateGuideRequest({
      query: "Which of those?",
      history: [
        {
          role: "assistant",
          content: "I found two options.",
          eventIds: ["event-one", "event-two"],
        },
      ],
    }),
    true,
  );
  assert.equal(
    validateGuideRequest({
      query: "Which of those?",
      history: [
        {
          role: "user",
          content: "I found two options.",
          eventIds: ["event-one"],
        },
      ],
    }),
    false,
  );
  assert.equal(
    validateGuideRequest({
      query: "Hello",
      profile: { interests: ["AI"] },
    }),
    false,
  );
  assert.equal(
    validateGuideRequest({
      query: "Hello",
      profile: { datePreference: "x".repeat(161) },
    }),
    false,
  );
  assert.equal(
    validateGuideRequest({
      query: "Hello",
      history: Array.from({ length: 9 }, () => ({
        role: "user",
        content: "hi",
      })),
    }),
    false,
  );
});
