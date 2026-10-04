import { MessageSquare, Trash2 } from "lucide-react";
import type { Conversation } from "../lib/conversations";

export function HistoryPanel({
  conversations,
  currentId,
  canSwitch,
  onOpen,
  onDelete,
  onClearAll
}: {
  conversations: Conversation[];
  currentId: string;
  canSwitch: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}) {
  return (
    <section className="history-panel response-surface" aria-label="Chat history">
      <div className="history-heading">
        <span>Recent chats</span>
        {conversations.length > 0 ? (
          <button
            type="button"
            className="history-clear"
            disabled={!canSwitch}
            onClick={() => {
              if (window.confirm("Delete all saved chats on this device?")) onClearAll();
            }}
          >
            Clear all
          </button>
        ) : null}
      </div>
      {conversations.length === 0 ? (
        <p className="history-empty">Chats you have will appear here. Only text is saved.</p>
      ) : (
        <ul className="history-list">
          {conversations.map((conversation) => (
            <li
              key={conversation.id}
              className={`history-item ${conversation.id === currentId ? "is-current" : ""}`}
            >
              <button
                type="button"
                className="history-open"
                disabled={!canSwitch}
                onClick={() => onOpen(conversation.id)}
              >
                <MessageSquare size={14} aria-hidden="true" />
                <span className="history-copy">
                  <span className="history-title">{conversation.title}</span>
                  <small>
                    {formatDate(conversation.updatedAt)} · {conversation.messages.length} messages
                  </small>
                </span>
              </button>
              <button
                type="button"
                className="history-delete"
                disabled={!canSwitch}
                title={`Delete "${conversation.title}"`}
                aria-label={`Delete "${conversation.title}"`}
                onClick={() => onDelete(conversation.id)}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
