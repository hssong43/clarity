import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPTURE_SHORTCUT,
  formatShortcut,
  loadCaptureShortcut,
  saveCaptureShortcut,
  shortcutFromKeyboardEvent
} from "./shortcuts";

const noModifiers = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("shortcuts", () => {
  it("builds accelerators from key presses", () => {
    expect(
      shortcutFromKeyboardEvent({ ...noModifiers, ctrlKey: true, shiftKey: true, code: "KeyK" })
    ).toBe("Ctrl+Shift+KeyK");
    expect(shortcutFromKeyboardEvent({ ...noModifiers, metaKey: true, code: "Digit1" })).toBe(
      "Super+Digit1"
    );
    expect(shortcutFromKeyboardEvent({ ...noModifiers, code: "F5" })).toBe("F5");
  });

  it("ignores modifier-only presses and unmodified keys", () => {
    expect(shortcutFromKeyboardEvent({ ...noModifiers, ctrlKey: true, code: "ControlLeft" })).toBe(
      null
    );
    expect(shortcutFromKeyboardEvent({ ...noModifiers, code: "KeyA" })).toBeNull();
    expect(shortcutFromKeyboardEvent({ ...noModifiers, shiftKey: false, code: "" })).toBeNull();
  });

  it("formats accelerators for display per platform", () => {
    expect(formatShortcut(DEFAULT_CAPTURE_SHORTCUT, false)).toBe("Ctrl+Shift+Space");
    expect(formatShortcut(DEFAULT_CAPTURE_SHORTCUT, true)).toBe("Cmd+Shift+Space");
    expect(formatShortcut("Super+Alt+KeyK", true)).toBe("Cmd+Option+K");
    expect(formatShortcut("Super+Digit1", false)).toBe("Win+1");
    expect(formatShortcut("", false)).toBe("Off");
  });

  it("persists the chosen shortcut, including disabled", () => {
    const storage = new MemoryStorage();
    expect(loadCaptureShortcut(storage)).toBe(DEFAULT_CAPTURE_SHORTCUT);
    saveCaptureShortcut("Ctrl+Alt+KeyC", storage);
    expect(loadCaptureShortcut(storage)).toBe("Ctrl+Alt+KeyC");
    saveCaptureShortcut("", storage);
    expect(loadCaptureShortcut(storage)).toBe("");
  });
});
