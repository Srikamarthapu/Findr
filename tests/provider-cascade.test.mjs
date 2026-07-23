import assert from "node:assert/strict";
import test from "node:test";
import { runGuide } from "../server/guide-service.mjs";
import {
  ProviderError,
  streamProviderCompletion,
} from "../server/providers.mjs";

function sseResponse(value, status = 200) {
  if (status !== 200) return new Response("", { status });
  const stream = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: value } }] })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const validAnswer = JSON.stringify({
  summary: "Two verified weekend hackathons match.",
  eventIds: [
    "you-agentic-hackathon-2026-07-24",
    "jachacks-sf-2026-07-26",
  ],
  caveat: "Neither organizer publishes an age policy.",
  question: "Do you prefer Friday or Sunday?",
});

test("stream adapter detects a live signal and buffers valid content", async () => {
  let alive = 0;
  const result = await streamProviderCompletion(
    {
      endpoint: "https://provider.invalid/chat",
      key: "test-key",
      model: "test-model",
      extraBody: {},
    },
    {
      messages: [{ role: "user", content: "Return JSON" }],
      fetchImpl: async () => sseResponse(validAnswer),
      onAlive: () => {
        alive += 1;
      },
    },
  );
  assert.equal(result, validAnswer);
  assert.equal(alive, 1);
});

test("first-signal timeout is classified for fallback", async () => {
  await assert.rejects(
    streamProviderCompletion(
      {
        endpoint: "https://provider.invalid/chat",
        key: "test-key",
        model: "test-model",
        extraBody: {},
      },
      {
        messages: [{ role: "user", content: "Return JSON" }],
        env: {
          FINDR_FIRST_SIGNAL_TIMEOUT_MS: "15",
          FINDR_TOTAL_TIMEOUT_MS: "100",
        },
        fetchImpl: (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(options.signal.reason),
              { once: true },
            );
          }),
      },
    ),
    (error) =>
      error instanceof ProviderError &&
      error.code === "first_signal_timeout",
  );
});

test("cascade falls from NVIDIA Pro to NVIDIA Flash", async () => {
  const models = [];
  const result = await runGuide({
    query: "What can I do this weekend?",
    preferences: { age: 16, maxCost: 20 },
    now: new Date("2026-07-23T12:00:00-07:00"),
    env: { NVIDIA_NIM_API_KEY: "test-key" },
    fetchImpl: async (_url, options) => {
      const model = JSON.parse(options.body).model;
      models.push(model);
      return model.endsWith("v4-pro")
        ? sseResponse("", 503)
        : sseResponse(validAnswer);
    },
  });
  assert.deepEqual(models, [
    "deepseek-ai/deepseek-v4-pro",
    "deepseek-ai/deepseek-v4-flash",
  ]);
  assert.equal(result.model, "deepseek-ai/deepseek-v4-flash");
  assert.equal(result.message.eventIds.length, 2);
});

test("all provider failures return a labeled grounded fallback", async () => {
  const result = await runGuide({
    query: "hands-on AI",
    preferences: { age: 16, maxCost: 20 },
    now: new Date("2026-07-23T12:00:00-07:00"),
    env: {
      NVIDIA_NIM_API_KEY: "test-key",
      ZAI_API_KEY: "test-key",
      DEEPSEEK_API_KEY: "test-key",
    },
    fetchImpl: async () => sseResponse("", 503),
  });
  assert.equal(result.provider, "local");
  assert.equal(result.message.degraded, true);
  assert.ok(result.message.eventIds.length > 0);
});
