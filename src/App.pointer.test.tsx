import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { MODEL_PROFILES_STORAGE_KEY } from "./lib/modelProfiles";
import { POINTER_MODIFIER_STORAGE_KEY } from "./lib/pointer";
import { onPointerCapture, setPointerModifier, type PointerCaptureEvent } from "./lib/tauri";
import type { CapturedImage } from "./types";

vi.mock("./lib/visionClient", () => ({ streamVisionChat: vi.fn() }));
vi.mock("./lib/tauri", async (importActual) => ({
  ...(await importActual<typeof import("./lib/tauri")>()),
  onPointerCapture: vi.fn(),
  setPointerModifier: vi.fn()
}));

let fireGesture: (event: PointerCaptureEvent) => void = () => undefined;

const regionImage: CapturedImage = {
  mime: "image/jpeg",
  dataUrl: "data:image/jpeg;base64,AA",
  width: 400,
  height: 200,
  displayId: "1-region"
};

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

async function renderApp() {
  await act(async () => {
    render(<App />);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollTo = vi.fn();
  vi.mocked(onPointerCapture).mockImplementation(async (handler) => {
    fireGesture = handler;
    return () => undefined;
  });
  vi.mocked(setPointerModifier).mockReset().mockResolvedValue(undefined);
});

describe("pointer gestures", () => {
  it("tells the native layer the saved modifier on startup", async () => {
    window.localStorage.setItem(POINTER_MODIFIER_STORAGE_KEY, "primary");
    await renderApp();

    expect(setPointerModifier).toHaveBeenCalledWith("primary");
  });

  it("opens the panel and focuses the question field on a modifier click", async () => {
    seedProfile();
    await renderApp();

    await act(async () => fireGesture({ kind: "click" }));

    expect(screen.queryByRole("button", { name: "Clarity overlay" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Message Clarity")).toHaveFocus();
    expect(screen.queryByLabelText("Pending attachments")).not.toBeInTheDocument();
  });

  it("attaches the dragged region and opens the panel", async () => {
    seedProfile();
    await renderApp();

    await act(async () => fireGesture({ kind: "region", image: regionImage, error: null }));

    expect(screen.getByText("Screen attached")).toBeInTheDocument();
    expect(screen.getByText("region")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask about the attachments")).toHaveFocus();
  });

  it("shows a region capture failure", async () => {
    seedProfile();
    await renderApp();

    await act(async () =>
      fireGesture({ kind: "region", image: null, error: "Select a larger region" })
    );

    expect(screen.getByText("Select a larger region")).toBeInTheDocument();
  });

  it("opens profile setup instead of attaching when no profile exists", async () => {
    await renderApp();

    await act(async () => fireGesture({ kind: "region", image: regionImage, error: null }));

    expect(screen.getByText("Profile needed")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pending attachments")).not.toBeInTheDocument();
  });

  it("switches the mouse key from settings and remembers it", async () => {
    await renderApp();
    const alt = screen.getByRole("button", { name: /^(Alt|Option)$/ });
    const primary = screen.getByRole("button", { name: /^(Ctrl|Cmd)$/ });
    expect(alt).toHaveAttribute("aria-pressed", "true");

    await act(async () => fireEvent.click(primary));

    expect(setPointerModifier).toHaveBeenLastCalledWith("primary");
    expect(window.localStorage.getItem(POINTER_MODIFIER_STORAGE_KEY)).toBe("primary");
    expect(primary).toHaveAttribute("aria-pressed", "true");
    expect(alt).toHaveAttribute("aria-pressed", "false");
  });
});
