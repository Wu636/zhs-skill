/**
 * Minimal SSE consumer: yields parsed JSON data frames.
 * Handles `data:`, comments/heartbeats, CRLF, and multi-line data.
 */
export async function consumeSSE(response, onEvent) {
  if (!response.body) throw new Error("响应没有可读流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  const events = [];

  const dispatch = () => {
    if (dataLines.length === 0) return;
    const raw = dataLines.join("\n").trim();
    dataLines = [];
    if (!raw) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { type: "raw", content: raw };
    }
    events.push(parsed);
    if (onEvent) onEvent(parsed);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let lineEnd;
    while ((lineEnd = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, lineEnd).replace(/\r$/, "");
      buffer = buffer.slice(lineEnd + 1);
      if (line === "") {
        dispatch();
        continue;
      }
      if (line.startsWith(":")) continue;
      if (/^data\s*:/i.test(line)) {
        dataLines.push(line.replace(/^data\s*:\s?/i, ""));
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      if (/^data\s*:/i.test(line)) {
        dataLines.push(line.replace(/^data\s*:\s?/i, ""));
      }
    }
  }
  dispatch();
  return events;
}

export async function readErrorResponse(response) {
  const text = await response.text().catch(() => "");
  if (!text) return `HTTP ${response.status} ${response.statusText}`;
  try {
    const data = JSON.parse(text);
    return data.error || data.message || text;
  } catch {
    return text.slice(0, 400);
  }
}
