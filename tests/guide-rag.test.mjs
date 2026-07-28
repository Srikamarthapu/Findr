import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroundedMessages,
  groundedFallback,
  retrieveEvents,
  validateGuideAnswer,
} from "../server/catalog.mjs";

const now = new Date("2026-07-28T12:00:00-07:00");

test("weekend retrieval returns only verified upcoming weekend events", () => {
  const results = retrieveEvents({
    query: "What can I do this weekend?",
    preferences: { maxCost: 20 },
    now,
  });
  assert.ok(results.length > 0);
  assert.ok(
    results.every(
      (event) =>
        event.verificationStatus === "verified" &&
        event.sourceHref.startsWith("https://"),
    ),
  );
  assert.ok(
    results.every((event) => {
      const day = new Date(event.startAt).getDay();
      return [0, 5, 6].includes(day);
    }),
  );
});

test("confirmed age eligibility remains an honest no-match", () => {
  const results = retrieveEvents({
    query: "Confirmed age eligibility only",
    preferences: { age: 16, maxCost: 20 },
    now,
  });
  assert.equal(results.length, 0);
  const fallback = groundedFallback(results, "no_match");
  assert.equal(fallback.noMatch, true);
  assert.match(fallback.caveat, /age|minor/i);
});

test("model answers can reference only retrieved catalog ids", () => {
  const results = retrieveEvents({
    query: "AI this weekend",
    preferences: { maxCost: 20 },
    now,
  });
  assert.throws(
    () =>
      validateGuideAnswer(
        JSON.stringify({
          summary: "Try this event.",
          eventIds: ["made-up-event"],
          caveat: null,
          question: "Want another?",
        }),
        results,
      ),
    /model_output_ungrounded_ids/,
  );
});

test("raw catalog ids are replaced with event titles in user-visible model text", () => {
  const results = retrieveEvents({
    query: "AI startup events",
    preferences: { origin: "Bay Area" },
    now,
    limit: 2,
  });
  assert.ok(results.length > 0);
  const event = results[0];
  const answer = validateGuideAnswer(
    JSON.stringify({
      summary: `${event.id} is the strongest match.`,
      eventIds: [event.id],
      caveat: `Confirm details for ${event.id}.`,
      question: `Would you like to compare ${event.id}?`,
    }),
    results,
  );

  assert.match(answer.summary, new RegExp(event.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(answer.summary, new RegExp(event.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(answer.caveat, new RegExp(event.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(answer.question, new RegExp(event.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("grounding prompt carries exact canonical source records", () => {
  const results = retrieveEvents({
    query: "hands-on AI",
    preferences: { maxCost: 20 },
    now,
    limit: 3,
  });
  const previousId = results[0]?.id;
  const messages = buildGroundedMessages({
    query: "hands-on AI",
    preferences: { maxCost: 20 },
    history: previousId
      ? [
          {
            role: "assistant",
            content: "These are the current options.",
            eventIds: [previousId],
          },
        ]
      : [],
    retrievedEvents: results,
  });
  for (const event of results) {
    assert.match(messages[1].content, new RegExp(event.id));
    assert.match(messages[1].content, new RegExp(event.sourceHref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  if (previousId) {
    assert.match(messages[1].content, new RegExp(previousId));
  }
});

test("startup aliases retrieve founder-tagged events from the expanded catalog", () => {
  const results = retrieveEvents({
    query: "entrepreneur gathering",
    preferences: {
      maxCost: 20,
      origin: "Bay Area",
      date: "Any upcoming date",
    },
    now,
    limit: 5,
  });
  assert.ok(results.length > 0);
  assert.ok(
    results.some(
      (event) =>
        event.tags.includes("Startups") ||
        /\b(founder|startup|venture|yc)\b/i.test(event.title),
    ),
  );
});
