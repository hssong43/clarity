import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { MODEL_PROFILES_STORAGE_KEY, type ModelProfile } from "./lib/modelProfiles";
import { streamVisionChat, type StreamVisionChatOptions } from "./lib/visionClient";

vi.mock("./lib/visionClient", () => ({ streamVisionChat: vi.fn() }));

const savedProfile: ModelProfile = {
  id: "profile-1",
  name: "Work",
  provider: "anthropic",
  apiKey: "sk-ant-test",
  model: "claude-sonnet-5-5",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

function seedProfile() {
  window.localStorage.setItem(MODEL_PROFILES_STORAGE_KEY, JSON.stringify([savedProfile]));
}

function expandPill() {
  fireEvent.keyDown(screen.getByRole("button", { name: "Clarity overlay" }), { key: "Enter" });
}

function ask(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Message Clarity"), { target: { value: text } });
  fireEvent.click(screen.getByTitle("Send"));
}

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  vi.mocked(streamVisionChat).mockReset();
});

describe("App", () => {
  it("asks for a model profile first and collapses to the pill after saving", async () => {
    render(<App />);

    expect(screen.getByText("Profile needed")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Clarity overlay" })).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(MODEL_PROFILES_STORAGE_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ provider: "openai", apiKey: "sk-test" });
  });

  it("streams an answer into the conversation", async () => {
    seedProfile();
    vi.mocked(streamVisionChat).mockImplementation(async ({ onEvent }) => {
      onEvent({ type: "delta", text: "Hello " });
      onEvent({ type: "delta", text: "there" });
      onEvent({ type: "done", reason: "complete" });
    });
    render(<App />);

    expandPill();
    expect(screen.getByText("Claude - claude-sonnet-5-5")).toBeInTheDocument();
    await act(async () => ask("What is on screen?"));

    const conversation = document.querySelector<HTMLElement>(".conversation")!;
    expect(within(conversation).getByText("What is on screen?")).toBeInTheDocument();
    expect(within(conversation).getByText("Hello there")).toBeInTheDocument();
    const [options] = vi.mocked(streamVisionChat).mock.calls[0];
    expect(options.profile.id).toBe("profile-1");
    expect(options.request.messages).toEqual([{ role: "user", content: "What is on screen?" }]);
  });

  it("renders answers as markdown with a copy button", async () => {
    seedProfile();
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(streamVisionChat).mockImplementation(async ({ onEvent }) => {
      onEvent({ type: "delta", text: "**Bold** answer" });
      onEvent({ type: "done", reason: "complete" });
    });
    render(<App />);
    expandPill();

    await act(async () => ask("Explain"));

    expect(screen.getByText("Bold").tagName).toBe("STRONG");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy answer" })));
    expect(writeText).toHaveBeenCalledWith("**Bold** answer");
  });

  it("sends earlier turns as history", async () => {
    seedProfile();
    vi.mocked(streamVisionChat).mockImplementation(async ({ onEvent }) => {
      onEvent({ type: "delta", text: "Answer" });
      onEvent({ type: "done", reason: "complete" });
    });
    render(<App />);
    expandPill();

    await act(async () => ask("First"));
    await act(async () => ask("Second"));

    const [options] = vi.mocked(streamVisionChat).mock.calls[1];
    expect(options.request.messages).toEqual([
      { role: "user", content: "First" },
      { role: "assistant", content: "Answer" },
      { role: "user", content: "Second" }
    ]);
  });

  it("stops a streaming answer and keeps the partial text", async () => {
    seedProfile();
    let streamOptions: StreamVisionChatOptions | undefined;
    vi.mocked(streamVisionChat).mockImplementation((options) => {
      streamOptions = options;
      options.onEvent({ type: "delta", text: "Partial" });
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () =>
          reject(new DOMException("The request was cancelled.", "AbortError"))
        );
      });
    });
    render(<App />);
    expandPill();

    await act(async () => ask("Long question"));
    expect(screen.queryByTitle("Send")).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop" })));

    expect(streamOptions?.signal?.aborted).toBe(true);
    expect(screen.getByText("Partial")).toBeInTheDocument();
    expect(screen.getByTitle("Send")).toBeInTheDocument();
    expect(screen.queryByText(/cancelled/i)).not.toBeInTheDocument();
  });

  it("shows provider errors and clears them", async () => {
    seedProfile();
    vi.mocked(streamVisionChat).mockRejectedValue(new Error("API key not valid"));
    render(<App />);
    expandPill();

    await act(async () => ask("Hi"));
    expect(screen.getByText("API key not valid")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByText("API key not valid")).not.toBeInTheDocument();
  });

  it("offers Continue when the answer hits the output limit", async () => {
    seedProfile();
    vi.mocked(streamVisionChat).mockImplementation(async ({ onEvent }) => {
      onEvent({ type: "delta", text: "Cut" });
      onEvent({ type: "done", reason: "length" });
    });
    render(<App />);
    expandPill();

    await act(async () => ask("Explain"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue" })));

    const [options] = vi.mocked(streamVisionChat).mock.calls[1];
    expect(options.request.messages.at(-1)?.content).toMatch(/^Continue exactly/);
  });

  it("reports screen capture errors outside the desktop runtime", async () => {
    seedProfile();
    render(<App />);
    expandPill();

    await act(async () => fireEvent.click(screen.getByTitle("Attach current screen")));
    expect(
      screen.getByText("Tauri desktop runtime is required for screen capture.")
    ).toBeInTheDocument();
  });

  it("adds dropped text files as attachments and sends them", async () => {
    seedProfile();
    vi.mocked(streamVisionChat).mockImplementation(async ({ onEvent }) => {
      onEvent({ type: "done", reason: "complete" });
    });
    render(<App />);
    expandPill();

    const file = new File(["meeting notes"], "notes.txt", { type: "text/plain" });
    const panel = screen.getByRole("main");
    await act(async () => {
      fireEvent.drop(panel, { dataTransfer: { types: ["Files"], files: [file] } });
    });
    await screen.findByText("notes.txt");

    await act(async () => fireEvent.click(screen.getByTitle("Send")));
    const [options] = vi.mocked(streamVisionChat).mock.calls[0];
    expect(options.request.messages[0].files?.[0]).toMatchObject({
      name: "notes.txt",
      text: "meeting notes"
    });
    expect(screen.queryByLabelText("Pending attachments")).not.toBeInTheDocument();
  });

  it("deletes the active profile and returns to setup", () => {
    seedProfile();
    render(<App />);
    expandPill();

    fireEvent.click(screen.getByTitle("Model profiles"));
    fireEvent.click(screen.getByTitle("Delete profile"));

    expect(screen.getByText("Profile needed")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(MODEL_PROFILES_STORAGE_KEY) ?? "")).toEqual([]);
  });
});
