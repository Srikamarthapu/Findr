import { deleteVerifiedAccount } from "./account-service.mjs";

const MAX_BODY_BYTES = 1_024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 5;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    return (
      originUrl.host === request.headers.host ||
      ["localhost", "127.0.0.1", "terminal.local"].includes(
        originUrl.hostname,
      )
    );
  } catch {
    return false;
  }
}

async function readConfirmation(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new Error("body_too_large");
    }
  }
  const parsed = JSON.parse(body);
  return parsed?.confirmation === "DELETE";
}

export function findrAccountPlugin({ env = {} } = {}) {
  const rateBuckets = new Map();

  return {
    name: "findr-account-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(
          request.url || "/",
          "http://findr.local",
        ).pathname;

        if (pathname !== "/api/account/delete") {
          next();
          return;
        }
        if (request.method !== "POST") {
          sendJson(response, 405, {
            ok: false,
            error: { code: "method_not_allowed" },
          });
          return;
        }
        if (!isAllowedOrigin(request)) {
          sendJson(response, 403, {
            ok: false,
            error: { code: "origin_not_allowed" },
          });
          return;
        }
        if (
          !String(request.headers["content-type"] || "").startsWith(
            "application/json",
          )
        ) {
          sendJson(response, 415, {
            ok: false,
            error: { code: "json_required" },
          });
          return;
        }

        const ip = request.socket.remoteAddress || "local";
        const now = Date.now();
        const bucket = (rateBuckets.get(ip) || []).filter(
          (timestamp) => now - timestamp < RATE_WINDOW_MS,
        );
        if (bucket.length >= RATE_LIMIT) {
          sendJson(response, 429, {
            ok: false,
            error: { code: "rate_limited" },
          });
          return;
        }
        bucket.push(now);
        rateBuckets.set(ip, bucket);

        try {
          const confirmed = await readConfirmation(request);
          if (!confirmed) {
            sendJson(response, 400, {
              ok: false,
              error: { code: "confirmation_required" },
            });
            return;
          }
        } catch (error) {
          sendJson(response, error.message === "body_too_large" ? 413 : 400, {
            ok: false,
            error: {
              code:
                error.message === "body_too_large"
                  ? "body_too_large"
                  : "invalid_json",
            },
          });
          return;
        }

        const result = await deleteVerifiedAccount({
          authorization: request.headers.authorization,
          env,
        });
        sendJson(response, result.status, result.body);
      });
    },
  };
}
