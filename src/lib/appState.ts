import type { StreamStopReason, VisionAction } from "../types";

export type ClarityMode = "IdleOrb" | "ExpandedReady" | "Capturing" | "Streaming" | "Error";

export type ChatMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
};

export type ClarityState = {
  mode: ClarityMode;
  activeAction: VisionAction | null;
  messages: ChatMessage[];
  partialAnswer: string;
  lastStopReason: StreamStopReason | null;
  lastStopMessage: string | null;
  error: string | null;
};

export type ClarityEvent =
  | { type: "EXPAND" }
  | { type: "COLLAPSE" }
  | { type: "CAPTURE_START"; action: VisionAction }
  | { type: "STREAM_START" }
  | { type: "STREAM_DELTA"; text: string }
  | { type: "STREAM_DONE"; reason?: StreamStopReason; message?: string }
  | { type: "FAIL"; error: string }
  | { type: "RESET_ERROR" }
  | { type: "USER_MESSAGE"; text: string }
  | { type: "LOAD_CONVERSATION"; messages: ChatMessage[] };

export const initialClarityState: ClarityState = {
  mode: "IdleOrb",
  activeAction: null,
  messages: [],
  partialAnswer: "",
  lastStopReason: null,
  lastStopMessage: null,
  error: null
};

export function clarityReducer(state: ClarityState, event: ClarityEvent): ClarityState {
  switch (event.type) {
    case "EXPAND":
      return { ...state, mode: "ExpandedReady", error: null };
    case "COLLAPSE":
      return {
        ...state,
        mode: "IdleOrb",
        activeAction: null,
        partialAnswer: "",
        lastStopReason: null,
        lastStopMessage: null,
        error: null
      };
    case "CAPTURE_START":
      return {
        ...state,
        mode: "Capturing",
        activeAction: event.action,
        partialAnswer: "",
        lastStopReason: null,
        lastStopMessage: null,
        error: null
      };
    case "STREAM_START":
      return {
        ...state,
        mode: "Streaming",
        lastStopReason: null,
        lastStopMessage: null,
        error: null
      };
    case "STREAM_DELTA":
      return { ...state, partialAnswer: state.partialAnswer + event.text };
    case "STREAM_DONE": {
      const content = state.partialAnswer.trim();
      return {
        ...state,
        mode: "ExpandedReady",
        activeAction: null,
        partialAnswer: "",
        lastStopReason: event.reason ?? "complete",
        lastStopMessage: event.message ?? null,
        messages: content
          ? [...state.messages, { id: crypto.randomUUID(), role: "assistant", content }]
          : state.messages
      };
    }
    case "FAIL":
      return {
        ...state,
        mode: "Error",
        activeAction: null,
        partialAnswer: "",
        lastStopReason: null,
        lastStopMessage: null,
        error: event.error
      };
    case "RESET_ERROR":
      return { ...state, mode: "ExpandedReady", error: null };
    case "LOAD_CONVERSATION":
      // Ignored mid-stream so an answer is never attached to the wrong chat.
      if (state.mode === "Streaming" || state.mode === "Capturing") {
        return state;
      }
      return {
        ...state,
        mode: state.mode === "Error" ? "ExpandedReady" : state.mode,
        messages: event.messages,
        partialAnswer: "",
        lastStopReason: null,
        lastStopMessage: null,
        error: null
      };
    case "USER_MESSAGE":
      return {
        ...state,
        lastStopReason: null,
        lastStopMessage: null,
        messages: [
          ...state.messages,
          { id: crypto.randomUUID(), role: "user", content: event.text }
        ]
      };
    default:
      return state;
  }
}
