import { handleApiRequest } from "./worker-api.mjs";

function headerEntries(headers = {}) {
  const entries = [];
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) entries.push([key, item]);
    } else if (value !== undefined) {
      entries.push([key, String(value)]);
    }
  }
  return entries;
}

async function readNodeBody(request) {
  if (request.body !== undefined) {
    if (
      typeof request.body === "string" ||
      request.body instanceof Uint8Array
    ) {
      return request.body;
    }
    return JSON.stringify(request.body);
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(
      chunk instanceof Uint8Array
        ? chunk
        : new TextEncoder().encode(String(chunk)),
    );
  }
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function toWebRequest(request, signal) {
  const headers = new Headers(headerEntries(request.headers));
  const forwardedProtocol = headers.get("x-forwarded-proto")?.split(",")[0];
  const protocol = forwardedProtocol || "https";
  const host = headers.get("host") || "findr.vercel.app";
  const url = new URL(request.url || "/", `${protocol}://${host}`);
  const method = request.method || "GET";
  const init = { method, headers, signal };
  if (!["GET", "HEAD"].includes(method)) {
    init.body = await readNodeBody(request);
  }
  return new Request(url, init);
}

async function sendWebResponse(response, nodeResponse) {
  nodeResponse.statusCode = response.status;
  for (const [key, value] of response.headers) {
    nodeResponse.setHeader(key, value);
  }

  if (!response.body) {
    nodeResponse.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (!nodeResponse.destroyed) {
      const { value, done } = await reader.read();
      if (done) break;
      nodeResponse.write(value);
    }
  } finally {
    if (nodeResponse.destroyed) {
      await reader.cancel().catch(() => {});
    } else {
      nodeResponse.end();
    }
  }
}

export async function serveVercelApi(
  request,
  response,
  env = process.env,
) {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("client_disconnected"));
  request.once?.("aborted", abort);
  response.once?.("close", abort);

  try {
    const webRequest = await toWebRequest(request, controller.signal);
    const webResponse = await handleApiRequest(webRequest, env);
    if (!webResponse) {
      response.statusCode = 404;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    await sendWebResponse(webResponse, response);
  } catch {
    if (!response.headersSent && !response.destroyed) {
      response.statusCode = 500;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "internal_server_error" }));
    } else if (!response.destroyed) {
      response.end();
    }
  } finally {
    request.removeListener?.("aborted", abort);
    response.removeListener?.("close", abort);
  }
}
