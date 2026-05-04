import { describe, expect, it } from "vitest";
import { parseSsePacket, parseSseStream } from "./sse";

describe("SSE parsing", () => {
  it("parses delta packets", () => {
    expect(parseSsePacket('data: {"type":"delta","text":"hi"}\n\n')).toEqual({
      type: "delta",
      text: "hi"
    });
  });

  it("streams multiple packets", async () => {
    const chunks = new TextEncoder().encode(
      'data: {"type":"delta","text":"A"}\n\n' +
        'data: {"type":"delta","text":"B"}\n\n' +
        'data: {"type":"done"}\n\n'
    );
    const seen: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunks);
        controller.close();
      }
    });

    await parseSseStream(stream, (event) => seen.push(event.type));
    expect(seen).toEqual(["delta", "delta", "done"]);
  });

  it("defaults legacy done packets to complete", () => {
    expect(parseSsePacket('data: {"type":"done"}\n\n')).toEqual({
      type: "done",
      reason: "complete"
    });
  });
});
