import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { CONVERSATIONS_STORAGE_KEY } from "./lib/conversations";
import { MODEL_PROFILES_STORAGE_KEY } from "./lib/modelProfiles";
import { streamVisionChat } from "./lib/visionClient";

vi.mock("./lib/visionClient", () => ({ streamVisionChat: vi.fn() }));

function seedProfile() {
  window.localStorage.setItem(
    MODEL_PROFILES_STORAGE_KEY,
    JSON.stringify([
      {
        id: "p1",
        name: "Work",
        provider: "openai",
        apiKey: "sk-test",
        model: "gpt-5.4-mini",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ])
  );
}

function expandPill() {
  fireEvent.keyDown(screen.getByRole("button", { name: "Clarity overlay" }), { key: "Enter" });
}

async function ask(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Message Clarity"), { target: { value: text } });
  await act(async () => fireEvent.click(screen.getByTitle("Send")));
}

function savedConversations() {
  return JSON.parse(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY) ?? "[]") as Array<{
    title: string;
    messages: Array<{ role: string; content: string }>;
  }>;
}

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollTo = vi.fn();
  seedProfile();
  vi.mocked(streamVisionChat).mockImplementation(async ({ request, onEvent }) => {
    onEvent({ type: "delta", text: `Answer to ${request.messages.at(-1)?.content}` });
    onEvent({ type: "done", reason: "complete" });
  });
});

afterEach(() => {
  vi.mocked(streamVisionChat).mockReset();
});

describe("chat history", () => {
  it("saves each completed turn as text", async () => {
    render(<App />);
    expandPill();

    await ask("What is on screen?");

    const [conversation] = savedConversations();
    expect(conversation.title).toBe("What is on screen?");
    expect(conversation.messages).toEqual([
      expect.objectContaining({ role: "user", content: "What is on screen?" }),
      expect.objectContaining({ role: "assistant", content: "Answer to What is on screen?" })
    ]);
  });

  it("reopens the latest conversation after a restart", async () => {
    const first = render(<App />);
    expandPill();
    await ask("Remember me");
    first.unmount();

    render(<App />);
    expandPill();

    expect(screen.getByText("Remember me")).toBeInTheDocument();
    expect(screen.getByText("Answer to Remember me")).toBeInTheDocument();
  });

  it("starts new chats and switches between saved ones", async () => {
    render(<App />);
    expandPill();
    await ask("First chat");

    fireEvent.click(screen.getByTitle("New chat"));
    expect(screen.queryByText("First chat")).not.toBeInTheDocument();
    await ask("Second chat");

    // The follow-up only carries the second chat's history.
    const [options] = vi.mocked(streamVisionChat).mock.calls[1];
    expect(options.request.messages).toEqual([{ role: "user", content: "Second chat" }]);

    fireEvent.click(screen.getByTitle("Chat history"));
    const titles = screen.getAllByText(/chat$/).map((element) => element.textContent);
    expect(titles).toEqual(["Second chat", "First chat"]);

    fireEvent.click(screen.getByText("First chat"));
    expect(screen.getByText("Answer to First chat")).toBeInTheDocument();
    expect(screen.queryByText("Second chat")).not.toBeInTheDocument();
  });

  it("deletes a saved chat", async () => {
    render(<App />);
    expandPill();
    await ask("Keep");
    fireEvent.click(screen.getByTitle("New chat"));
    await ask("Remove");

    fireEvent.click(screen.getByTitle("Chat history"));
    fireEvent.click(screen.getByRole("button", { name: 'Delete "Keep"' }));

    expect(savedConversations().map((conversation) => conversation.title)).toEqual(["Remove"]);
    expect(screen.queryByText("Keep")).not.toBeInTheDocument();
  });

  it("blocks switching chats while an answer is streaming", async () => {
    vi.mocked(streamVisionChat).mockImplementation(() => new Promise(() => undefined));
    render(<App />);
    expandPill();

    await ask("Long answer");

    expect(screen.getByTitle("New chat")).toBeDisabled();
  });
});
