import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import catalogMeta from "../src/catalog-meta.json" with { type: "json" };
import worker from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  }
});

test("serves guide health from the worker without touching static assets", async () => {
  let assetCalls = 0;
  const response = await worker.fetch(
    new Request("https://example.test/api/guide/health"),
    {
      ASSETS: {
        fetch: async () => {
          assetCalls += 1;
          return new Response("unexpected", { status: 500 });
        },
      },
      NVIDIA_NIM_API_KEY: "configured",
      ZAI_API_KEY: "configured",
      DEEPSEEK_API_KEY: "configured",
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.ok(body.catalog.count > 0);
  assert.equal(body.catalog.generatedAt, catalogMeta.generatedAt);
  assert.equal(body.catalog.verifiedAt, body.catalog.generatedAt);
  assert.equal(body.catalog.sources.length, 5);
  assert.ok(
    body.catalog.sources.some((source) =>
      source.name.includes("DataSF Our415"),
    ),
  );
  assert.ok(
    body.catalog.sources.some((source) =>
      source.name.includes("Luma San Francisco"),
    ),
  );
  assert.deepEqual(body.providers, {
    nvidia: true,
    zai: true,
    deepseek: true,
  });
  assert.equal(assetCalls, 0);
});

test("streams deterministic intake from the production guide route", async () => {
  let assetCalls = 0;
  const response = await worker.fetch(
    new Request("https://example.test/api/guide", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.test",
      },
      body: JSON.stringify({ query: "Hello", profile: {} }),
    }),
    {
      ASSETS: {
        fetch: async () => {
          assetCalls += 1;
          return new Response("unexpected", { status: 500 });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type"),
    /application\/x-ndjson/,
  );
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events[0].type, "answer");
  assert.equal(events[0].provider, "intake");
  assert.match(events[0].message.question, /how old/i);
  assert.equal(events.at(-1).type, "done");
  assert.equal(assetCalls, 0);
});

test("routes account deletion to the server service boundary", async () => {
  let assetCalls = 0;
  const response = await worker.fetch(
    new Request("https://example.test/api/account/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.test",
      },
      body: JSON.stringify({ confirmation: "DELETE" }),
    }),
    {
      ASSETS: {
        fetch: async () => {
          assetCalls += 1;
          return new Response("unexpected", { status: 500 });
        },
      },
    },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "unauthorized",
      message: "A valid sign-in is required.",
    },
  });
  assert.equal(assetCalls, 0);
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});

test("emits a self-contained executable Sites worker bundle", async () => {
  const bundledWorkerUrl = new URL("../dist/server/index.js", import.meta.url);
  const source = await readFile(bundledWorkerUrl, "utf8");
  assert.doesNotMatch(
    source,
    /^\s*import\s+(?:[\s\S]*?\sfrom\s*)?["'](?:node:|@supabase\/|\.\.?\/)/m,
  );
  assert.match(source, /\/api\/guide/);
  assert.match(source, /\/api\/account\/delete/);

  const bundledWorker = (await import(`${bundledWorkerUrl.href}?test=${Date.now()}`))
    .default;
  const response = await bundledWorker.fetch(
    new Request("https://example.test/api/guide/health"),
    {
      ASSETS: {
        fetch: async () => new Response("unexpected", { status: 500 }),
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "ok");
});
