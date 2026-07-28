import { deleteVerifiedAccount } from "./account-service.mjs";
import { catalogHealth } from "./catalog-health.mjs";
import { runGuide } from "./guide-service.mjs";
import {
  utf8ByteLength,
  validateGuideRequest,
} from "./guide-request.mjs";

const GUIDE_MAX_BODY_BYTES = 32_768;
const GUIDE_RATE_WINDOW_MS = 60_000;
const GUIDE_RATE_LIMIT = 20;
const GUIDE_MAX_CONCURRENT = 4;

const ACCOUNT_MAX_BODY_BYTES = 1_024;
const ACCOUNT_RATE_WINDOW_MS = 60_000;
const ACCOUNT_RATE_LIMIT = 5;

const encoder = new TextEncoder();
const guideRateBuckets = new Map();
const accountRateBuckets = new Map();
let concurrentGuideRequests = 0;

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isAllowedOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    return (
      originUrl.host === requestUrl.host ||
      ["localhost", "127.0.0.1", "terminal.local"].includes(
        originUrl.hostname,
      )
    );
  } catch {
    return false;
  }
}

function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    request.headers.get("cf-connecting-ip") ||
    forwarded?.split(",")[0]?.trim() ||
    "local"
  );
}

function consumeRateLimit({
  request,
  buckets,
  limit,
  windowMs,
}) {
  const ip = clientIp(request);
  const now = Date.now();
  const bucket = (buckets.get(ip) || []).filter(
    (timestamp) => now - timestamp < windowMs,
  );
  if (bucket.length >= limit) return false;
  bucket.push(now);
  buckets.set(ip, bucket);
  return true;
}

async function readJsonBody(request, maxBytes) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("body_too_large");
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new Error("body_too_large");
  }
  const text = new TextDecoder().decode(buffer);
  if (utf8ByteLength(text) > maxBytes) {
    throw new Error("body_too_large");
  }
  return JSON.parse(text);
}

function guideHealth(env) {
  return {
    status: "ok",
    catalog: catalogHealth(),
    providers: {
      nvidia: Boolean(env.NVIDIA_NIM_API_KEY),
      zai: Boolean(env.ZAI_API_KEY),
      deepseek: Boolean(env.DEEPSEEK_API_KEY),
    },
  };
}

async function handleGuideHealth(request, env) {
  if (request.method !== "GET") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }
  return jsonResponse(200, guideHealth(env));
}

async function handleGuide(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }
  if (!isAllowedOrigin(request)) {
    return jsonResponse(403, { error: "origin_not_allowed" });
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return jsonResponse(415, { error: "json_required" });
  }
  if (
    !consumeRateLimit({
      request,
      buckets: guideRateBuckets,
      limit: GUIDE_RATE_LIMIT,
      windowMs: GUIDE_RATE_WINDOW_MS,
    })
  ) {
    return jsonResponse(429, { error: "rate_limited" });
  }
  if (concurrentGuideRequests >= GUIDE_MAX_CONCURRENT) {
    return jsonResponse(503, { error: "guide_busy" });
  }

  let payload;
  try {
    payload = await readJsonBody(request, GUIDE_MAX_BODY_BYTES);
  } catch (error) {
    const bodyTooLarge = error?.message === "body_too_large";
    return jsonResponse(bodyTooLarge ? 413 : 400, {
      error: bodyTooLarge ? "body_too_large" : "invalid_json",
    });
  }
  if (!validateGuideRequest(payload)) {
    return jsonResponse(400, { error: "invalid_request" });
  }

  concurrentGuideRequests += 1;
  const requestController = new AbortController();
  const abortFromRequest = () =>
    requestController.abort(request.signal.reason);
  if (request.signal.aborted) {
    abortFromRequest();
  } else {
    request.signal.addEventListener("abort", abortFromRequest, {
      once: true,
    });
  }

  let streamClosed = false;
  const stream = new ReadableStream({
    start(controller) {
      const emit = (event) => {
        if (streamClosed) return;
        try {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(event)}\n`),
          );
        } catch {
          streamClosed = true;
          requestController.abort(new Error("response_closed"));
        }
      };

      void (async () => {
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
            signal: requestController.signal,
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
          if (!requestController.signal.aborted) {
            emit({
              type: "error",
              error: "guide_request_failed",
              message:
                "The live guide could not finish this request. Please try again.",
            });
          }
        } finally {
          concurrentGuideRequests -= 1;
          request.signal.removeEventListener("abort", abortFromRequest);
          if (!streamClosed) {
            streamClosed = true;
            controller.close();
          }
        }
      })();
    },
    cancel(reason) {
      streamClosed = true;
      requestController.abort(reason);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handleAccountDelete(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: { code: "method_not_allowed" },
    });
  }
  if (!isAllowedOrigin(request)) {
    return jsonResponse(403, {
      ok: false,
      error: { code: "origin_not_allowed" },
    });
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return jsonResponse(415, {
      ok: false,
      error: { code: "json_required" },
    });
  }
  if (
    !consumeRateLimit({
      request,
      buckets: accountRateBuckets,
      limit: ACCOUNT_RATE_LIMIT,
      windowMs: ACCOUNT_RATE_WINDOW_MS,
    })
  ) {
    return jsonResponse(429, {
      ok: false,
      error: { code: "rate_limited" },
    });
  }

  let payload;
  try {
    payload = await readJsonBody(request, ACCOUNT_MAX_BODY_BYTES);
  } catch (error) {
    const bodyTooLarge = error?.message === "body_too_large";
    return jsonResponse(bodyTooLarge ? 413 : 400, {
      ok: false,
      error: {
        code: bodyTooLarge ? "body_too_large" : "invalid_json",
      },
    });
  }
  if (payload?.confirmation !== "DELETE") {
    return jsonResponse(400, {
      ok: false,
      error: { code: "confirmation_required" },
    });
  }

  const result = await deleteVerifiedAccount({
    authorization: request.headers.get("authorization"),
    env,
  });
  return jsonResponse(result.status, result.body);
}

export async function handleApiRequest(request, env = {}) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/guide/health") {
    return handleGuideHealth(request, env);
  }
  if (pathname === "/api/guide") {
    return handleGuide(request, env);
  }
  if (pathname === "/api/account/delete") {
    return handleAccountDelete(request, env);
  }
  return null;
}
