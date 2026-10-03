import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isAbortError, streamNativeHttp, type NativeHttpRequest } from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({}));

type StreamPayload = {
  requestId: string;
  kind: "chunk" | "done" | "error";
  bytes?: number[];
};

const request: NativeHttpRequest = {
  method: "POST",
  url: "https://api.openai.com/v1/responses",
  headers: [],
  body: "{}"
};

let emit: (payload: StreamPayload) => void;
const unlisten = vi.fn();

function bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function pendingStream() {
  let finish!: (error?: unknown) => void;
  let requestId = "";
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === "stream_http_request") {
      requestId = (args as { request: { requestId: string } }).request.requestId;
      return new Promise((resolve, reject) => {
        finish = (error) => (error ? reject(error) : resolve(undefined));
      });
    }
    if (command === "cancel_http_request") {
      finish("The request was cancelled.");
    }
    return Promise.resolve(undefined);
  });
  return { finish: (error?: unknown) => finish(error), requestId: () => requestId };
}

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  vi.mocked(listen).mockImplementation(async (_event, handler) => {
    emit = (payload) => (handler as (event: { payload: StreamPayload }) => void)({ payload });
    return unlisten;
  });
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.mocked(invoke).mockReset();
  unlisten.mockReset();
});

describe("streamNativeHttp", () => {
  it("forwards chunks for its own request id", async () => {
    const stream = pendingStream();
    const chunks: string[] = [];
    const done = streamNativeHttp(request, (chunk) => chunks.push(chunk));
    await vi.waitFor(() => expect(stream.requestId()).not.toBe(""));

    emit({ requestId: "other", kind: "chunk", bytes: bytes("x") });
    emit({ requestId: stream.requestId(), kind: "chunk", bytes: bytes("hello") });
    stream.finish();
    await done;

    expect(chunks).toEqual(["hello"]);
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("cancels the native request on abort and rejects with an AbortError", async () => {
    const stream = pendingStream();
    const controller = new AbortController();
    const chunks: string[] = [];
    const done = streamNativeHttp(request, (chunk) => chunks.push(chunk), controller.signal);
    await vi.waitFor(() => expect(stream.requestId()).not.toBe(""));

    controller.abort();
    emit({ requestId: stream.requestId(), kind: "chunk", bytes: bytes("late") });

    const error = await done.catch((caught: unknown) => caught);
    expect(isAbortError(error)).toBe(true);
    expect(invoke).toHaveBeenCalledWith("cancel_http_request", {
      requestId: stream.requestId()
    });
    expect(chunks).toEqual([]);
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("does not start a request when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await streamNativeHttp(request, () => undefined, controller.signal).catch(
      (caught: unknown) => caught
    );

    expect(isAbortError(error)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("wraps native failures as regular errors", async () => {
    const stream = pendingStream();
    const done = streamNativeHttp(request, () => undefined);
    await vi.waitFor(() => expect(stream.requestId()).not.toBe(""));

    stream.finish("HTTP 401: unauthorized");
    const error = await done.catch((caught: unknown) => caught);

    expect(isAbortError(error)).toBe(false);
    expect((error as Error).message).toBe("HTTP 401: unauthorized");
  });
});
