import { useCallback, useEffect, useReducer, useRef } from "react";
import type { VisionChatMessage } from "../types";
import { clarityReducer, initialClarityState, type ChatMessage } from "../lib/appState";
import { collectReadyAttachmentPayload, type PendingAttachment } from "../lib/attachments";
import type { ModelProfile } from "../lib/modelProfiles";
import { isAbortError } from "../lib/tauri";
import { streamVisionChat } from "../lib/visionClient";

const CONTINUE_PROMPT =
  "Continue exactly from where you stopped. Do not restart or repeat previous text.";

type SendOptions = {
  attachments?: PendingAttachment[];
  visibleText?: string;
  /** Called once the attachments have been added to the outgoing message. */
  onAttachmentsSent?: () => void;
};

export function useChatStream({
  activeProfile,
  onMissingProfile
}: {
  activeProfile: ModelProfile | null;
  onMissingProfile: () => void;
}) {
  const [state, dispatch] = useReducer(clarityReducer, initialClarityState);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => streamAbortRef.current?.abort(), []);

  const sendChatMessage = useCallback(
    async (text: string, options: SendOptions = {}) => {
      if (!activeProfile) {
        dispatch({ type: "EXPAND" });
        onMissingProfile();
        dispatch({
          type: "FAIL",
          error: "Add a model profile before using Clarity."
        });
        return;
      }

      const trimmedQuestion = text.trim();
      const attachmentPayload = options.attachments
        ? collectReadyAttachmentPayload(options.attachments)
        : { images: [], files: [], names: [] };
      const fallbackQuestion =
        attachmentPayload.names.length > 0
          ? `Please review the attached ${attachmentPayload.names.length === 1 ? "item" : "items"}.`
          : "";
      const messageText = trimmedQuestion || fallbackQuestion;

      if (!messageText) {
        return;
      }

      const currentMessage: VisionChatMessage = {
        role: "user",
        content: messageText,
        images: attachmentPayload.images.length > 0 ? attachmentPayload.images : undefined,
        files: attachmentPayload.files.length > 0 ? attachmentPayload.files : undefined
      };
      const requestMessages = [...toProviderMessages(state.messages), currentMessage];
      const visibleMessage =
        attachmentPayload.names.length > 0
          ? `${messageText}\n\nAttached: ${attachmentPayload.names.join(", ")}`
          : messageText;

      dispatch({ type: "USER_MESSAGE", text: options.visibleText ?? visibleMessage });
      if (options.attachments) {
        options.onAttachmentsSent?.();
      }
      dispatch({ type: "STREAM_START" });
      const controller = new AbortController();
      streamAbortRef.current = controller;
      try {
        await streamVisionChat({
          profile: activeProfile,
          request: { messages: requestMessages },
          signal: controller.signal,
          onEvent(event) {
            if (event.type === "delta") {
              dispatch({ type: "STREAM_DELTA", text: event.text });
            } else if (event.type === "done") {
              dispatch({ type: "STREAM_DONE", reason: event.reason, message: event.message });
            } else {
              dispatch({ type: "FAIL", error: event.message });
            }
          }
        });
      } catch (error) {
        if (isAbortError(error)) {
          dispatch({ type: "STREAM_DONE", reason: "cancelled" });
        } else {
          dispatch({
            type: "FAIL",
            error: error instanceof Error ? error.message : "The request failed."
          });
        }
      } finally {
        if (streamAbortRef.current === controller) {
          streamAbortRef.current = null;
        }
      }
    },
    [activeProfile, onMissingProfile, state.messages]
  );

  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  const continueAnswer = useCallback(() => {
    void sendChatMessage(CONTINUE_PROMPT, { visibleText: "Continue" });
  }, [sendChatMessage]);

  return { state, dispatch, sendChatMessage, stopStreaming, continueAnswer };
}

function toProviderMessages(messages: ChatMessage[]): VisionChatMessage[] {
  return messages.flatMap((message) =>
    message.role === "assistant" || message.role === "user"
      ? [{ role: message.role, content: message.content }]
      : []
  );
}
