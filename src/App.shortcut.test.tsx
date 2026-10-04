import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { MODEL_PROFILES_STORAGE_KEY } from "./lib/modelProfiles";
import { CAPTURE_SHORTCUT_STORAGE_KEY } from "./lib/shortcuts";
import { captureRegion, captureScreens, onCaptureShortcut, setCaptureShortcut } from "./lib/tauri";

vi.mock("./lib/visionClient", () => ({ streamVisionChat: vi.fn() }));
vi.mock("./lib/tauri", async (importActual) => ({
  ...(await importActual<typeof import("./lib/tauri")>()),
  captureScreens: vi.fn(),
  captureRegion: vi.fn(),
  onCaptureShortcut: vi.fn(),
  setCaptureShortcut: vi.fn()
}));

let fireShortcut: () => void = () => undefined;

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

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollTo = vi.fn();
  vi.mocked(onCaptureShortcut).mockImplementation(async (handler) => {
    fireShortcut = handler;
    return () => undefined;
  });
  vi.mocked(setCaptureShortcut).mockReset().mockResolvedValue(undefined);
  vi.mocked(captureScreens)
    .mockReset()
    .mockResolvedValue([
      {
        mime: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,AA",
        width: 1,
        height: 1,
        displayId: "1"
      }
    ]);
});

describe("capture shortcut", () => {
  it("registers the default shortcut on startup", async () => {
    seedProfile();
    await act(async () => {
      render(<App />);
    });

    expect(setCaptureShortcut).toHaveBeenCalledWith("CommandOrControl+Shift+Space");
  });

  it("opens the panel, attaches the screen, and focuses the question field", async () => {
    seedProfile();
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByRole("button", { name: "Clarity overlay" })).toBeInTheDocument();

    await act(async () => fireShortcut());

    expect(captureScreens).toHaveBeenCalledOnce();
    expect(screen.getByText("Screen attached")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask about the attachments")).toHaveFocus();
  });

  it("opens profile setup instead of capturing when no profile exists", async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => fireShortcut());

    expect(captureScreens).not.toHaveBeenCalled();
    expect(screen.getByText("Profile needed")).toBeInTheDocument();
  });

  it("records a new shortcut from the settings field", async () => {
    await act(async () => {
      render(<App />);
    });

    const field = screen.getByLabelText("Capture shortcut keys");
    act(() => field.focus());
    expect(field).toHaveValue("Press keys…");
    await act(async () => {
      fireEvent.keyDown(field, { code: "KeyK", key: "K", ctrlKey: true, shiftKey: true });
    });

    expect(setCaptureShortcut).toHaveBeenLastCalledWith("Ctrl+Shift+KeyK");
    expect(window.localStorage.getItem(CAPTURE_SHORTCUT_STORAGE_KEY)).toBe("Ctrl+Shift+KeyK");
    expect(field).toHaveValue("Ctrl+Shift+K");
  });

  it("keeps the previous shortcut when registration fails", async () => {
    await act(async () => {
      render(<App />);
    });
    vi.mocked(setCaptureShortcut).mockRejectedValueOnce("Ctrl+Alt+KeyC could not be registered.");

    const field = screen.getByLabelText("Capture shortcut keys");
    act(() => field.focus());
    expect(field).toHaveValue("Press keys…");
    await act(async () => {
      fireEvent.keyDown(field, { code: "KeyC", key: "c", ctrlKey: true, altKey: true });
    });

    expect(screen.getByText("Ctrl+Alt+KeyC could not be registered.")).toBeInTheDocument();
    expect(setCaptureShortcut).toHaveBeenLastCalledWith("CommandOrControl+Shift+Space");
    expect(window.localStorage.getItem(CAPTURE_SHORTCUT_STORAGE_KEY)).toBeNull();
    expect(field).toHaveValue("Ctrl+Shift+Space");
  });
});

describe("region capture", () => {
  async function openPanel() {
    seedProfile();
    await act(async () => {
      render(<App />);
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Clarity overlay" }), { key: "Enter" });
  }

  it("attaches the selected region", async () => {
    vi.mocked(captureRegion).mockResolvedValue({
      mime: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA",
      width: 400,
      height: 200,
      displayId: "1-region"
    });
    await openPanel();

    await act(async () => fireEvent.click(screen.getByTitle("Attach a screen region")));

    expect(captureRegion).toHaveBeenCalledOnce();
    expect(captureScreens).not.toHaveBeenCalled();
    expect(screen.getByText("Screen attached")).toBeInTheDocument();
    expect(screen.getByText("region")).toBeInTheDocument();
  });

  it("does nothing when the selection is cancelled", async () => {
    vi.mocked(captureRegion).mockResolvedValue(null);
    await openPanel();

    await act(async () => fireEvent.click(screen.getByTitle("Attach a screen region")));

    expect(screen.queryByLabelText("Pending attachments")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });

  it("reports region capture failures", async () => {
    vi.mocked(captureRegion).mockRejectedValue(new Error("Select a larger region"));
    await openPanel();

    await act(async () => fireEvent.click(screen.getByTitle("Attach a screen region")));

    expect(screen.getByText("Select a larger region")).toBeInTheDocument();
  });
});
