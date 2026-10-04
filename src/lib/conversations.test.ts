import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./appState";
import {
  CONVERSATIONS_STORAGE_KEY,
  MAX_CONVERSATIONS,
  conversationTitle,
  isSaved,
  loadConversations,
  saveConversations,
  upsertConversation,
  type Conversation
} from "./conversations";

class MemoryStorage {
  values = new Map<string, string>();
  limit = Infinity;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (value.length > this.limit) throw new Error("QuotaExceededError");
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const user = (id: string, content: string): ChatMessage => ({ id, role: "user", content });
const assistant = (id: string, content: string): ChatMessage => ({
  id,
  role: "assistant",
  content
});

describe("conversations", () => {
  it("titles conversations from the first user message without the attachment list", () => {
    expect(conversationTitle([user("1", "Summarize this\n\nAttached: Screen")])).toBe(
      "Summarize this"
    );
    expect(conversationTitle([])).toBe("New conversation");
    expect(conversationTitle([user("1", "x".repeat(80))])).toHaveLength(48);
  });

  it("upserts newest first and keeps creation time", () => {
    let list = upsertConversation([], "a", [user("1", "First")], "2026-01-01T00:00:00Z");
    list = upsertConversation(list, "b", [user("2", "Second")], "2026-01-02T00:00:00Z");
    list = upsertConversation(
      list,
      "a",
      [user("1", "First"), assistant("3", "Answer")],
      "2026-01-03T00:00:00Z"
    );

    expect(list.map((conversation) => conversation.id)).toEqual(["a", "b"]);
    expect(list[0]).toMatchObject({
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-03T00:00:00Z"
    });
    expect(list[0].messages).toHaveLength(2);
  });

  it("caps the number of saved conversations", () => {
    let list: Conversation[] = [];
    for (let index = 0; index < MAX_CONVERSATIONS + 5; index += 1) {
      list = upsertConversation(list, `c${index}`, [user(`${index}`, `Q${index}`)]);
    }
    expect(list).toHaveLength(MAX_CONVERSATIONS);
    expect(list[0].id).toBe(`c${MAX_CONVERSATIONS + 4}`);
  });

  it("round-trips through storage and ignores malformed data", () => {
    const storage = new MemoryStorage();
    const list = upsertConversation([], "a", [user("1", "Hi"), assistant("2", "Hello")]);
    saveConversations(list, storage);
    expect(loadConversations(storage)).toEqual(list);

    storage.values.set(CONVERSATIONS_STORAGE_KEY, "not json");
    expect(loadConversations(storage)).toEqual([]);
    storage.values.set(CONVERSATIONS_STORAGE_KEY, JSON.stringify([{ id: 1 }, list[0]]));
    expect(loadConversations(storage)).toEqual([list[0]]);
  });

  it("drops the oldest conversations when storage is full", () => {
    const storage = new MemoryStorage();
    let list: Conversation[] = [];
    for (let index = 0; index < 5; index += 1) {
      list = upsertConversation(list, `c${index}`, [user(`${index}`, "x".repeat(100))]);
    }
    storage.limit = JSON.stringify(list.slice(0, 2)).length;

    const kept = saveConversations(list, storage);

    expect(kept.map((conversation) => conversation.id)).toEqual(["c4", "c3"]);
    expect(loadConversations(storage)).toEqual(kept);
  });

  it("detects whether messages are already saved", () => {
    const messages = [user("1", "Hi"), assistant("2", "Hello")];
    const [saved] = upsertConversation([], "a", messages);
    expect(isSaved(saved, messages)).toBe(true);
    expect(isSaved(saved, [...messages, user("3", "More")])).toBe(false);
    expect(isSaved(undefined, messages)).toBe(false);
  });
});
