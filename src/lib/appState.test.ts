import { describe, expect, it, vi } from "vitest";
import { clarityReducer, initialClarityState } from "./appState";

vi.stubGlobal("crypto", {
  randomUUID: () => "test-id"
});

describe("clarityReducer", () => {
  it("moves from pill to capture to streaming to ready", () => {
    let state = clarityReducer(initialClarityState, {
      type: "CAPTURE_START",
      action: "summarize"
    });
    expect(state.mode).toBe("Capturing");
    expect(state.activeAction).toBe("summarize");

    state = clarityReducer(state, { type: "STREAM_START" });
    state = clarityReducer(state, { type: "STREAM_DELTA", text: "First " });
    state = clarityReducer(state, { type: "STREAM_DELTA", text: "answer" });
    state = clarityReducer(state, { type: "STREAM_DONE" });

    expect(state.mode).toBe("ExpandedReady");
    expect(state.messages.at(-1)?.content).toBe("First answer");
    expect(state.partialAnswer).toBe("");
  });

  it("preserves user and assistant chat history across turns", () => {
    let state = clarityReducer(initialClarityState, { type: "USER_MESSAGE", text: "Hello" });
    state = clarityReducer(state, { type: "STREAM_START" });
    state = clarityReducer(state, { type: "STREAM_DELTA", text: "Hi there." });
    state = clarityReducer(state, { type: "STREAM_DONE" });
    state = clarityReducer(state, { type: "USER_MESSAGE", text: "Continue" });

    expect(state.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Hello"],
      ["assistant", "Hi there."],
      ["user", "Continue"]
    ]);
    expect(state.lastStopReason).toBeNull();
  });

  it("records length-limited stream completion", () => {
    let state = clarityReducer(initialClarityState, { type: "STREAM_START" });
    state = clarityReducer(state, { type: "STREAM_DELTA", text: "Partial answer" });
    state = clarityReducer(state, {
      type: "STREAM_DONE",
      reason: "length",
      message: "Anthropic stopped because max_tokens."
    });

    expect(state.mode).toBe("ExpandedReady");
    expect(state.messages.at(-1)?.content).toBe("Partial answer");
    expect(state.lastStopReason).toBe("length");
    expect(state.lastStopMessage).toBe("Anthropic stopped because max_tokens.");
  });

  it("keeps the panel recoverable after errors", () => {
    const errored = clarityReducer(initialClarityState, {
      type: "FAIL",
      error: "Model profile is required"
    });
    expect(errored.mode).toBe("Error");

    const recovered = clarityReducer(errored, { type: "RESET_ERROR" });
    expect(recovered.mode).toBe("ExpandedReady");
    expect(recovered.error).toBeNull();
  });

  it("keeps the partial answer when a stream is cancelled", () => {
    let state = clarityReducer(initialClarityState, { type: "USER_MESSAGE", text: "Hello" });
    state = clarityReducer(state, { type: "STREAM_START" });
    state = clarityReducer(state, { type: "STREAM_DELTA", text: "Partial" });
    state = clarityReducer(state, { type: "STREAM_DONE", reason: "cancelled" });

    expect(state.mode).toBe("ExpandedReady");
    expect(state.messages.at(-1)).toMatchObject({ role: "assistant", content: "Partial" });
    expect(state.lastStopReason).toBe("cancelled");
  });
});
