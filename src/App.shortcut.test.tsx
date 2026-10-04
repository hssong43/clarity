import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { MODEL_PROFILES_STORAGE_KEY } from "./lib/modelProfiles";
import { CAPTURE_SHORTCUT_STORAGE_KEY, REGION_SHORTCUT_STORAGE_KEY } from "./lib/shortcuts";
import { captureRegion, captureScreens, onCaptureShortcut, setCaptureShortcuts } from "./lib/tauri";

vi.mock("./lib/visionClient", () => ({ streamVisionChat: vi.fn() }));
vi.mock("./lib/tauri", async (importActual) => ({
  ...(await importActual<typeof import("./lib/tauri")>()),
  captureScreens: vi.fn(),
  captureRegion: vi.fn(),
  onCaptureShortcut: vi.fn(),
  setCaptureShortcuts: vi.fn()
}));

let fireShortcut: (area: "full" | "region") => void = () => undefined;

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
  vi.mocked(setCaptureShortcuts).mockReset().mockResolvedValue(undefined);
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

    expect(setCaptureShortcuts).toHaveBeenCalledWith(
      "CommandOrControl+Shift+Space",
      "Alt+Shift+Space"
    );
  });

  it("opens the panel, attaches the screen, and focuses the question field", async () => {
    seedProfile();
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByRole("button", { name: "Clarity overlay" })).toBeInTheDocument();

    await act(async () => fireShortcut("full"));

    expect(captureScreens).toHaveBeenCalledOnce();
    expect(screen.getByText("Screen attached")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask about the attachments")).toHaveFocus();
  });

  it("opens profile setup instead of capturing when no profile exists", async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => fireShortcut("full"));

    expect(captureScreens).not.toHaveBeenCalled();
    expect(screen.getByText("Profile needed")).toBeInTheDocument();
  });

  it("records a new shortcut from the settings field", async () => {
    await act(async () => {
      render(<App />);
    });

    const field = screen.getByLabelText("Full-screen capture keys");
    act(() => field.focus());
    expect(field).toHaveValue("Press keys…");
    await act(async () => {
      fireEvent.keyDown(field, { code: "KeyK", key: "K", ctrlKey: true, shiftKey: true });
    });

    expect(setCaptureShortcuts).toHaveBeenLastCalledWith("Ctrl+Shift+KeyK", "Alt+Shift+Space");
    expect(window.localStorage.getItem(CAPTURE_SHORTCUT_STORAGE_KEY)).toBe("Ctrl+Shift+KeyK");
    expect(field).toHaveValue("Ctrl+Shift+K");
  });

  it("keeps the previous shortcut when registration fails", async () => {
    await act(async () => {
      render(<App />);
    });
    vi.mocked(setCaptureShortcuts).mockRejectedValueOnce("Ctrl+Alt+KeyC could not be registered.");

    const field = screen.getByLabelText("Full-screen capture keys");
    act(() => field.focus());
    expect(field).toHaveValue("Press keys…");
    await act(async () => {
      fireEvent.keyDown(field, { code: "KeyC", key: "c", ctrlKey: true, altKey: true });
    });

    expect(screen.getByText("Ctrl+Alt+KeyC could not be registered.")).toBeInTheDocument();
    expect(setCaptureShortcuts).toHaveBeenLastCalledWith(
      "CommandOrControl+Shift+Space",
      "Alt+Shift+Space"
    );
    expect(window.localStorage.getItem(CAPTURE_SHORTCUT_STORAGE_KEY)).toBeNull();
    expect(field).toHaveValue("Ctrl+Shift+Space");
  });
});

describe("region capture shortcut", () => {
  it("starts a region capture from its shortcut", async () => {
    seedProfile();
    vi.mocked(captureRegion).mockResolvedValue({
      mime: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA",
      width: 10,
      height: 10,
      displayId: "1-region"
    });
    await act(async () => {
      render(<App />);
    });

    await act(async () => fireShortcut("region"));

    expect(captureRegion).toHaveBeenCalledOnce();
    expect(captureScreens).not.toHaveBeenCalled();
    expect(screen.getByText("region")).toBeInTheDocument();
  });

  it("records a region shortcut and rejects one equal to the full-screen shortcut", async () => {
    await act(async () => {
      render(<App />);
    });
    const field = screen.getByLabelText("Region capture keys");

    act(() => field.focus());
    await act(async () => {
      fireEvent.keyDown(field, { code: "KeyR", key: "R", ctrlKey: true, altKey: true });
    });
    expect(setCaptureShortcuts).toHaveBeenLastCalledWith(
      "CommandOrControl+Shift+Space",
      "Ctrl+Alt+KeyR"
    );
    expect(window.localStorage.getItem(REGION_SHORTCUT_STORAGE_KEY)).toBe("Ctrl+Alt+KeyR");

    vi.mocked(setCaptureShortcuts).mockClear();
    const fullField = screen.getByLabelText("Full-screen capture keys");
    act(() => fullField.focus());
    await act(async () => {
      fireEvent.keyDown(fullField, { code: "KeyR", key: "R", ctrlKey: true, altKey: true });
    });
    expect(setCaptureShortcuts).not.toHaveBeenCalled();
    expect(
      screen.getByText("Use different keys for full-screen and region capture.")
    ).toBeInTheDocument();
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
