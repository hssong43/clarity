import { useEffect, useRef } from "react";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import type { ClarityState } from "../lib/appState";
import { CopyButton } from "./CopyButton";
import { Markdown } from "./Markdown";
import { StatusLine } from "./StatusLine";

export function Conversation({
  state,
  isBusy,
  isCapturingAttachment,
  onDismissError,
  onContinue
}: {
  state: ClarityState;
  isBusy: boolean;
  isCapturingAttachment: boolean;
  onDismissError: () => void;
  onContinue: () => void;
}) {
  const conversationRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) {
      return;
    }

    conversation.scrollTop = conversation.scrollHeight;
  }, [state.messages, state.mode, state.partialAnswer]);

  return (
    <section
      ref={conversationRef}
      className="conversation response-surface"
      aria-live="polite"
      aria-busy={isBusy}
    >
      {state.messages.length === 0 && state.mode === "ExpandedReady" ? (
        <div className="empty-state">
          <span className="empty-mark">
            <Sparkles size={20} />
          </span>
          <p>Send a message, or attach the screen when you want visual context.</p>
        </div>
      ) : null}

      {state.messages.map((message) =>
        message.role === "assistant" ? (
          <article key={message.id} className="message assistant">
            <Markdown text={message.content} />
            <div className="message-actions">
              <CopyButton label="Copy answer" getText={() => message.content} />
            </div>
          </article>
        ) : (
          <article key={message.id} className={`message ${message.role}`}>
            {message.content}
          </article>
        )
      )}

      {isCapturingAttachment ? (
        <StatusLine icon={<Loader2 size={16} className="spin" />} text="Capturing screen" />
      ) : null}
      {state.mode === "Streaming" ? (
        <article className="message assistant streaming">
          {state.partialAnswer ? (
            <Markdown text={state.partialAnswer} />
          ) : (
            <StatusLine icon={<Loader2 size={16} className="spin" />} text="Thinking" />
          )}
        </article>
      ) : null}
      {state.mode === "Error" ? (
        <div className="error-box">
          <AlertCircle size={16} />
          <span>{state.error}</span>
          <button type="button" onClick={onDismissError}>
            OK
          </button>
        </div>
      ) : null}
      {state.mode !== "Streaming" && state.lastStopReason === "length" ? (
        <div className="continuation-box">
          <AlertCircle size={16} />
          <span>
            The provider stopped because it reached the output limit.
            {state.lastStopMessage ? ` ${state.lastStopMessage}` : ""}
          </span>
          <button type="button" onClick={onContinue} disabled={isBusy}>
            Continue
          </button>
        </div>
      ) : null}
    </section>
  );
}
