import { type FormEvent, useState } from "react";
import { Camera, Loader2, Send, Square } from "lucide-react";
import type { PendingAttachment } from "../lib/attachments";
import { AttachmentChip } from "./AttachmentChip";

export function Composer({
  pendingAttachments,
  hasPendingScreen,
  hasReadyAttachments,
  isReadingAttachment,
  isCapturingAttachment,
  isBusy,
  isStreaming,
  captureDisabled,
  onCapture,
  onRemoveAttachment,
  onSend,
  onStop
}: {
  pendingAttachments: PendingAttachment[];
  hasPendingScreen: boolean;
  hasReadyAttachments: boolean;
  isReadingAttachment: boolean;
  isCapturingAttachment: boolean;
  isBusy: boolean;
  isStreaming: boolean;
  captureDisabled: boolean;
  onCapture: () => void;
  onRemoveAttachment: (id: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [question, setQuestion] = useState("");
  const canSubmitQuestion =
    Boolean(question.trim() || hasReadyAttachments) && !isBusy && !isReadingAttachment;

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    const text = question;
    setQuestion("");
    onSend(text);
  };

  return (
    <div className="composer">
      {pendingAttachments.length > 0 ? (
        <div className="attachment-tray" aria-label="Pending attachments">
          {pendingAttachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              onRemove={() => onRemoveAttachment(attachment.id)}
            />
          ))}
        </div>
      ) : null}
      <form className="ask-form input-dock" onSubmit={submitQuestion}>
        <button
          className={`attach-button ${hasPendingScreen ? "is-active" : ""}`}
          type="button"
          disabled={isBusy || captureDisabled}
          onClick={onCapture}
          title={hasPendingScreen ? "Replace screen attachment" : "Attach current screen"}
        >
          {isCapturingAttachment ? <Loader2 size={15} className="spin" /> : <Camera size={15} />}
        </button>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={hasReadyAttachments ? "Ask about the attachments" : "Message Clarity"}
          disabled={isBusy}
        />
        {isStreaming ? (
          <button
            className="send-button"
            type="button"
            onClick={onStop}
            title="Stop"
            aria-label="Stop"
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button className="send-button" type="submit" disabled={!canSubmitQuestion} title="Send">
            <Send size={15} />
          </button>
        )}
      </form>
    </div>
  );
}
