const DEFAULT_FIRST_SIGNAL_TIMEOUT_MS = 12_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 45_000;
const MAX_STREAM_BYTES = 96_000;

export class ProviderError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createProviderChain(env = {}) {
  return [
    {
      provider: "nvidia",
      providerLabel: "NVIDIA NIM",
      model: env.NVIDIA_PRO_MODEL || "deepseek-ai/deepseek-v4-pro",
      endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
      key: env.NVIDIA_NIM_API_KEY,
      extraBody: { reasoning_effort: "none" },
    },
    {
      provider: "nvidia",
      providerLabel: "NVIDIA NIM",
      model: env.NVIDIA_FLASH_MODEL || "deepseek-ai/deepseek-v4-flash",
      endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
      key: env.NVIDIA_NIM_API_KEY,
      extraBody: { reasoning_effort: "none" },
    },
    {
      provider: "zai",
      providerLabel: "Z.ai",
      model: env.ZAI_MODEL || "glm-5-turbo",
      endpoint: "https://api.z.ai/api/paas/v4/chat/completions",
      key: env.ZAI_API_KEY,
      extraBody: {
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
      },
    },
    {
      provider: "deepseek",
      providerLabel: "DeepSeek",
      model: env.DEEPSEEK_PRO_MODEL || "deepseek-v4-pro",
      endpoint: "https://api.deepseek.com/chat/completions",
      key: env.DEEPSEEK_API_KEY,
      extraBody: {
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
      },
    },
    {
      provider: "deepseek",
      providerLabel: "DeepSeek",
      model: env.DEEPSEEK_FLASH_MODEL || "deepseek-v4-flash",
      endpoint: "https://api.deepseek.com/chat/completions",
      key: env.DEEPSEEK_API_KEY,
      extraBody: {
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
      },
    },
  ].filter((candidate) => typeof candidate.key === "string" && candidate.key);
}

function parseDataLine(line, state) {
  if (!line.startsWith("data:")) return;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return;

  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new ProviderError("invalid_sse");
  }
  if (parsed.error) {
    throw new ProviderError("provider_stream_error");
  }
  const choice = parsed.choices?.[0];
  if (!choice) return;
  const content = choice.delta?.content;
  if (typeof content === "string") {
    state.content += content;
  }
  if (choice.finish_reason === "length") {
    state.truncated = true;
  }
}

export async function streamProviderCompletion(
  candidate,
  {
    messages,
    env = {},
    fetchImpl = fetch,
    signal,
    onAlive = () => {},
  },
) {
  const controller = new AbortController();
  let timeoutCode = null;
  let sawSignal = false;
  let totalBytes = 0;
  const firstSignalTimeoutMs = positiveInteger(
    env.FINDR_FIRST_SIGNAL_TIMEOUT_MS,
    DEFAULT_FIRST_SIGNAL_TIMEOUT_MS,
  );
  const totalTimeoutMs = positiveInteger(
    env.FINDR_TOTAL_TIMEOUT_MS,
    DEFAULT_TOTAL_TIMEOUT_MS,
  );

  const abortFromCaller = () => {
    timeoutCode = "client_aborted";
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) abortFromCaller();
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  const firstTimer = setTimeout(() => {
    timeoutCode = "first_signal_timeout";
    controller.abort(new Error(timeoutCode));
  }, firstSignalTimeoutMs);
  const totalTimer = setTimeout(() => {
    timeoutCode = "generation_timeout";
    controller.abort(new Error(timeoutCode));
  }, totalTimeoutMs);

  try {
    const response = await fetchImpl(candidate.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${candidate.key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: candidate.model,
        messages,
        max_tokens: 900,
        temperature: 0.2,
        stream: true,
        ...candidate.extraBody,
      }),
      signal: controller.signal,
    });

    if (response.status === 202) {
      throw new ProviderError("provider_pending", 202);
    }
    if (!response.ok || !response.body) {
      throw new ProviderError(`http_${response.status}`, response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state = { content: "", truncated: false };
    let lineBuffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!sawSignal && value?.byteLength) {
        sawSignal = true;
        clearTimeout(firstTimer);
        onAlive();
      }
      totalBytes += value?.byteLength ?? 0;
      if (totalBytes > MAX_STREAM_BYTES) {
        throw new ProviderError("provider_output_too_large");
      }

      lineBuffer += decoder.decode(value, { stream: true });
      let newlineIndex = lineBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        parseDataLine(line, state);
        newlineIndex = lineBuffer.indexOf("\n");
      }
    }

    lineBuffer += decoder.decode();
    if (lineBuffer.trim()) parseDataLine(lineBuffer.trim(), state);
    if (!sawSignal) {
      throw new ProviderError("empty_stream");
    }
    if (state.truncated) {
      throw new ProviderError("output_truncated");
    }
    if (!state.content.trim()) {
      throw new ProviderError("empty_completion");
    }
    return state.content;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) {
      throw new ProviderError(timeoutCode || "request_aborted");
    }
    throw new ProviderError("network_error");
  } finally {
    clearTimeout(firstTimer);
    clearTimeout(totalTimer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
