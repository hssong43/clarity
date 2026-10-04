import type { ChatMessage } from "./appState";

export const CONVERSATIONS_STORAGE_KEY = "clarity.conversations.v1";
export const MAX_CONVERSATIONS = 30;
const TITLE_MAX_CHARS = 48;

/** A saved chat. Only text is kept; screenshots and file contents are never stored. */
export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadConversations(storage: StorageLike = window.localStorage): Conversation[] {
  try {
    const parsed = JSON.parse(storage.getItem(CONVERSATIONS_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isConversation) : [];
  } catch {
    return [];
  }
}

/**
 * Persists conversations, dropping the oldest when storage is full so the
 * newest history always fits.
 */
export function saveConversations(
  conversations: Conversation[],
  storage: StorageLike = window.localStorage
): Conversation[] {
  let kept = conversations.slice(0, MAX_CONVERSATIONS);
  while (kept.length > 0) {
    try {
      storage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(kept));
      return kept;
    } catch {
      kept = kept.slice(0, -1);
    }
  }
  try {
    storage.removeItem(CONVERSATIONS_STORAGE_KEY);
  } catch {
    // Nothing more to do; history simply is not persisted.
  }
  return kept;
}

/** Inserts or updates a conversation and moves it to the front (newest first). */
export function upsertConversation(
  conversations: Conversation[],
  id: string,
  messages: ChatMessage[],
  now = new Date().toISOString()
): Conversation[] {
  const existing = conversations.find((conversation) => conversation.id === id);
  const updated: Conversation = {
    id,
    title: conversationTitle(messages),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: messages.filter((message) => message.role !== "system")
  };
  return [updated, ...conversations.filter((conversation) => conversation.id !== id)].slice(
    0,
    MAX_CONVERSATIONS
  );
}

export function conversationTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  const text = (firstUser?.content ?? "").split("\n\nAttached:")[0].replace(/\s+/g, " ").trim();
  if (!text) return "New conversation";
  return text.length > TITLE_MAX_CHARS ? `${text.slice(0, TITLE_MAX_CHARS - 1)}…` : text;
}

/** True when the stored copy already matches these messages. */
export function isSaved(conversation: Conversation | undefined, messages: ChatMessage[]): boolean {
  if (!conversation || conversation.messages.length !== messages.length) return false;
  return conversation.messages.every(
    (message, index) =>
      message.id === messages[index].id && message.content === messages[index].content
  );
}

function isConversation(value: unknown): value is Conversation {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.messages) &&
    record.messages.every(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        typeof (message as ChatMessage).id === "string" &&
        typeof (message as ChatMessage).content === "string" &&
        ["user", "assistant"].includes((message as ChatMessage).role)
    )
  );
}
