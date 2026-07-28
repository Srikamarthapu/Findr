import { catalogHealth } from "./catalog-health.mjs";
import { runGuide } from "./guide-service.mjs";
import {
  utf8ByteLength,
  validateGuideRequest,
} from "./guide-request.mjs";

export { validateGuideRequest } from "./guide-request.mjs";

const MAX_BODY_BYTES = 32_768;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const MAX_CONCURRENT = 4;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (utf8ByteLength(body) > MAX_BODY_BYTES) {
      throw new Error("body_too_large");
    }
  }
  return JSON.parse(body);
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const requestHost = request.headers.host;
    return (
      originUrl.host === requestHost ||
      ["localhost", "127.0.0.1", "terminal.local"].includes(originUrl.hostname)
    );
  } catch {
    return false;
  }
}

export function findrGuidePlugin({ env = {} } = {}) {
  const rateBuckets = new Map();
  let concurrent = 0;

  return {
    name: "findr-guide-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(
          request.url || "/",
          "http://findr.local",
        ).pathname;

        if (pathname === "/api/guide/health") {
          if (request.method !== "GET") {
            sendJson(response, 405, { error: "method_not_allowed" });
            return;
          }
          sendJson(response, 200, {
            status: "ok",
            catalog: catalogHealth(),
            providers: {
              nvidia: Boolean(env.NVIDIA_NIM_API_KEY),
              zai: Boolean(env.ZAI_API_KEY),
              deepseek: Boolean(env.DEEPSEEK_API_KEY),
            },
          });
          return;
        }

        if (pathname !== "/api/guide") {
          next();
          return;
        }
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "method_not_allowed" });
          return;
        }
        if (!isAllowedOrigin(request)) {
          sendJson(response, 403, { error: "origin_not_allowed" });
          return;
        }
        if (!String(request.headers["content-type"] || "").startsWith(
          "application/json",
        )) {
          sendJson(response, 415, { error: "json_required" });
          return;
        }

        const ip = request.socket.remoteAddress || "local";
        const now = Date.now();
        const bucket = (rateBuckets.get(ip) || []).filter(
          (timestamp) => now - timestamp < RATE_WINDOW_MS,
        );
        if (bucket.length >= RATE_LIMIT) {
          sendJson(response, 429, { error: "rate_limited" });
          return;
        }
        bucket.push(now);
        rateBuckets.set(ip, bucket);
        if (concurrent >= MAX_CONCURRENT) {
          sendJson(response, 503, { error: "guide_busy" });
          return;
        }

        let payload;
        try {
          payload = await readJsonBody(request);
        } catch (error) {
          sendJson(response, error.message === "body_too_large" ? 413 : 400, {
            error:
              error.message === "body_too_large"
                ? "body_too_large"
                : "invalid_json",
          });
          return;
        }
        if (!validateGuideRequest(payload)) {
          sendJson(response, 400, { error: "invalid_request" });
          return;
        }

        concurrent += 1;
        const controller = new AbortController();
        response.on("close", () => {
          if (!response.writableEnded) controller.abort();
        });
        response.statusCode = 200;
        response.setHeader(
          "Content-Type",
          "application/x-ndjson; charset=utf-8",
        );
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Accel-Buffering", "no");

        const emit = (event) => {
          if (!response.destroyed) {
            response.write(`${JSON.stringify(event)}\n`);
          }
        };

        try {
          const result = await runGuide({
            query: payload.query.trim(),
            profile: payload.profile || {},
            preferences: payload.preferences || {},
            history: Array.isArray(payload.history)
              ? payload.history.slice(-8)
              : [],
            visibleEventIds: Array.isArray(payload.visibleEventIds)
              ? payload.visibleEventIds.slice(0, 100)
              : undefined,
            env,
            signal: controller.signal,
            emit,
          });
          emit({
            type: "done",
            provider: result.provider,
            providerLabel: result.providerLabel,
            model: result.model,
            attempts: result.attempts,
            profile: result.profile,
            intake: result.intake,
          });
        } catch {
          if (!controller.signal.aborted) {
            emit({
              type: "error",
              error: "guide_request_failed",
              message:
                "The live guide could not finish this request. Please try again.",
            });
          }
        } finally {
          concurrent -= 1;
          if (!response.destroyed) response.end();
        }
      });
    },
  };
}
