import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import deleteAccount from "../api/account/delete.js";
import guide from "../api/guide.js";
import guideHealth from "../api/guide/health.js";
import { serveVercelApi } from "../server/vercel-adapter.mjs";
import catalogMeta from "../src/catalog-meta.json" with { type: "json" };

class MockRequest extends EventEmitter {
  constructor({
    url,
    method = "GET",
    headers = {},
    body,
  }) {
    super();
    this.url = url;
    this.method = method;
    this.headers = headers;
    this.body = body;
  }
}

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = new Map();
    this.chunks = [];
    this.destroyed = false;
    this.headersSent = false;
    this.ended = false;
  }

  setHeader(key, value) {
    this.headers.set(key.toLowerCase(), String(value));
  }

  write(chunk) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    return true;
  }

  end(chunk) {
    if (chunk !== undefined) this.write(chunk);
    this.headersSent = true;
    this.ended = true;
    this.emit("finish");
  }

  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

async function invoke({
  url,
  method = "GET",
  headers = {},
  body,
  env = {},
}) {
  const request = new MockRequest({ url, method, headers, body });
  const response = new MockResponse();
  await serveVercelApi(request, response, env);
  return response;
}

test("exports Node serverless handlers for every production API route", () => {
  assert.equal(typeof guide, "function");
  assert.equal(typeof guideHealth, "function");
  assert.equal(typeof deleteAccount, "function");
});

test("Vercel adapter serves guide health with server environment status", async () => {
  const response = await invoke({
    url: "/api/guide/health",
    headers: { host: "findr.example" },
    env: {
      NVIDIA_NIM_API_KEY: "configured",
      ZAI_API_KEY: "configured",
      DEEPSEEK_API_KEY: "configured",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = JSON.parse(response.text());
  assert.equal(payload.status, "ok");
  assert.equal(payload.catalog.generatedAt, catalogMeta.generatedAt);
  assert.equal(payload.catalog.sources.length, 5);
  assert.deepEqual(payload.providers, {
    nvidia: true,
    zai: true,
    deepseek: true,
  });
});

test("Vercel adapter streams deterministic profile intake", async () => {
  const response = await invoke({
    url: "/api/guide",
    method: "POST",
    headers: {
      host: "findr.example",
      origin: "https://findr.example",
      "content-type": "application/json",
    },
    body: { query: "Hello", profile: {} },
  });

  assert.equal(response.statusCode, 200);
  assert.match(
    response.headers.get("content-type"),
    /application\/x-ndjson/,
  );
  const events = response
    .text()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events[0].provider, "intake");
  assert.match(events[0].message.question, /how old/i);
  assert.equal(events.at(-1).type, "done");
});

test("Vercel adapter keeps account deletion behind bearer verification", async () => {
  const response = await invoke({
    url: "/api/account/delete",
    method: "POST",
    headers: {
      host: "findr.example",
      origin: "https://findr.example",
      "content-type": "application/json",
    },
    body: { confirmation: "DELETE" },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.text()).error.code, "unauthorized");
});

test("Vercel routing preserves API functions before the SPA fallback", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(config.routes[0], { handle: "filesystem" });
  assert.match(config.routes[1].src, /^\/api/);
  assert.equal(config.routes[1].status, 404);
  assert.equal(config.routes.at(-1).dest, "/index.html");
});
