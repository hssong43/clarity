import { type Dispatch, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ClarityEvent, ClarityMode } from "../lib/appState";
import {
  isSaved,
  loadConversations,
  saveConversations,
  upsertConversation,
  type Conversation
} from "../lib/conversations";

/**
 * Keeps the current chat in local history. The latest conversation reopens on
 * launch; a new id is used until something is actually said.
 */
export function useConversations({
  messages,
  mode,
  dispatch
}: {
  messages: ChatMessage[];
  mode: ClarityMode;
  dispatch: Dispatch<ClarityEvent>;
}) {
  // Saved history excluding unsaved changes to the current chat.
  const [stored, setStored] = useState<Conversation[]>(() => loadConversations());
  const [currentId, setCurrentId] = useState(() => stored[0]?.id ?? crypto.randomUUID());
  const restoredRef = useRef(false);
  // Switching mid-answer would save the streamed reply under another chat.
  const canSwitch = mode !== "Streaming" && mode !== "Capturing";

  // History as shown: the current chat merged in once it has messages.
  const conversations = useMemo(() => {
    const current = stored.find((conversation) => conversation.id === currentId);
    if (messages.length === 0 || isSaved(current, messages)) return stored;
    return upsertConversation(stored, currentId, messages);
  }, [currentId, messages, stored]);

  // Reopen the most recent conversation once on startup.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const latest = stored[0];
    if (latest) {
      dispatch({ type: "LOAD_CONVERSATION", messages: latest.messages });
    }
  }, [stored, dispatch]);

  // Persist after each completed turn (never mid-stream).
  useEffect(() => {
    if (mode === "Streaming" || conversations === stored) return;
    saveConversations(conversations);
  }, [conversations, mode, stored]);

  const startNew = useCallback(() => {
    if (!canSwitch) return;
    setStored(conversations);
    setCurrentId(crypto.randomUUID());
    dispatch({ type: "LOAD_CONVERSATION", messages: [] });
  }, [canSwitch, conversations, dispatch]);

  const open = useCallback(
    (id: string) => {
      const conversation = conversations.find((candidate) => candidate.id === id);
      if (!conversation || !canSwitch) return;
      setStored(conversations);
      setCurrentId(id);
      dispatch({ type: "LOAD_CONVERSATION", messages: conversation.messages });
    },
    [canSwitch, conversations, dispatch]
  );

  const remove = useCallback(
    (id: string) => {
      const next = saveConversations(
        conversations.filter((conversation) => conversation.id !== id)
      );
      setStored(next);
      if (id === currentId && canSwitch) {
        setCurrentId(crypto.randomUUID());
        dispatch({ type: "LOAD_CONVERSATION", messages: [] });
      }
    },
    [canSwitch, conversations, currentId, dispatch]
  );

  const clearAll = useCallback(() => {
    setStored(saveConversations([]));
    if (canSwitch) {
      setCurrentId(crypto.randomUUID());
      dispatch({ type: "LOAD_CONVERSATION", messages: [] });
    }
  }, [canSwitch, dispatch]);

  return { conversations, currentId, canSwitch, startNew, open, remove, clearAll };
}
