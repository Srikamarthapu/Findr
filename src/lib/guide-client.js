export async function askGuide(
  payload,
  { onStatus = () => {}, signal } = {},
) {
  const response = await fetch("/api/guide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`guide_http_${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = null;
  let doneMetadata = null;

  const consumeLine = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    onStatus(event);
    if (event.type === "answer") answer = event;
    if (event.type === "done") doneMetadata = event;
    if (event.type === "error") {
      throw new Error(event.error || "guide_stream_error");
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      consumeLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);
  if (!answer) throw new Error("guide_missing_answer");
  return { ...answer, doneMetadata };
}
