import type { StreamEvent } from "../types";

export function parseSsePacket(packet: string): StreamEvent | null {
  const data = packet
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") {
    return null;
  }

  const parsed = JSON.parse(data) as StreamEvent;
  if (parsed.type === "done" && !("reason" in parsed)) {
    return { type: "done", reason: "complete" };
  }

  if (parsed.type === "delta" || parsed.type === "done" || parsed.type === "error") {
    return parsed;
  }

  throw new Error("Unsupported SSE event");
}

export async function parseSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = drainPackets(buffer, onEvent);
  }

  buffer += decoder.decode();
  drainPackets(buffer, onEvent, true);
}

function drainPackets(
  buffer: string,
  onEvent: (event: StreamEvent) => void,
  flush = false
): string {
  let remaining = buffer;
  let separatorIndex = findSeparator(remaining);

  while (separatorIndex >= 0) {
    const packet = remaining.slice(0, separatorIndex);
    const event = parseSsePacket(packet);
    if (event) {
      onEvent(event);
    }

    const separatorLength = remaining.startsWith("\r\n\r\n", separatorIndex) ? 4 : 2;
    remaining = remaining.slice(separatorIndex + separatorLength);
    separatorIndex = findSeparator(remaining);
  }

  if (flush && remaining.trim()) {
    const event = parseSsePacket(remaining);
    if (event) {
      onEvent(event);
    }
    return "";
  }

  return remaining;
}

function findSeparator(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}
