import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroundedMessages,
  groundedFallback,
  retrieveEvents,
  validateGuideAnswer,
} from "../server/catalog.mjs";

const now = new Date("2026-07-23T12:00:00-07:00");

test("weekend retrieval returns only verified upcoming weekend events", () => {
  const results = retrieveEvents({
    query: "What can I do this weekend?",
    preferences: { maxCost: 20 },
    now,
  });
  assert.deepEqual(
    results.map((event) => event.id),
    [
      "you-agentic-hackathon-2026-07-24",
      "jachacks-sf-2026-07-26",
    ],
  );
  assert.ok(results.every((event) => event.sourceHref.startsWith("https://luma.com/")));
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

test("grounding prompt carries exact canonical source records", () => {
  const results = retrieveEvents({
    query: "hands-on AI",
    preferences: { maxCost: 20 },
    now,
    limit: 3,
  });
  const messages = buildGroundedMessages({
    query: "hands-on AI",
    preferences: { maxCost: 20 },
    history: [],
    retrievedEvents: results,
  });
  for (const event of results) {
    assert.match(messages[1].content, new RegExp(event.id));
    assert.match(messages[1].content, new RegExp(event.sourceHref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
