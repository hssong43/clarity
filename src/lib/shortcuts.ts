export const DEFAULT_CAPTURE_SHORTCUT = "CommandOrControl+Shift+Space";
export const CAPTURE_SHORTCUT_STORAGE_KEY = "clarity.captureShortcut.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type KeyboardLike = Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight"
]);

/** Returns the saved shortcut, "" when disabled, or the default. */
export function loadCaptureShortcut(storage: StorageLike = window.localStorage): string {
  try {
    return storage.getItem(CAPTURE_SHORTCUT_STORAGE_KEY) ?? DEFAULT_CAPTURE_SHORTCUT;
  } catch {
    return DEFAULT_CAPTURE_SHORTCUT;
  }
}

export function saveCaptureShortcut(
  shortcut: string,
  storage: StorageLike = window.localStorage
): void {
  try {
    storage.setItem(CAPTURE_SHORTCUT_STORAGE_KEY, shortcut);
  } catch {
    // Not persisting only means the default is used next launch.
  }
}

/**
 * Builds an accelerator ("Ctrl+Shift+KeyK") from a key press, or null while only
 * modifiers are held. Plain keys need a modifier so typing is never hijacked;
 * function keys may stand alone.
 */
export function shortcutFromKeyboardEvent(event: KeyboardLike): string | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) {
    return null;
  }

  const modifiers = [
    event.ctrlKey ? "Ctrl" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    event.metaKey ? "Super" : null
  ].filter((modifier): modifier is string => modifier !== null);

  const isFunctionKey = /^F\d{1,2}$/.test(event.code);
  if (modifiers.length === 0 && !isFunctionKey) {
    return null;
  }

  return [...modifiers, event.code].join("+");
}

export function formatShortcut(shortcut: string, isMac = isMacPlatform()): string {
  if (!shortcut) {
    return "Off";
  }

  return shortcut
    .split("+")
    .map((part) => {
      if (part === "CommandOrControl") return isMac ? "Cmd" : "Ctrl";
      if (part === "Super") return isMac ? "Cmd" : "Win";
      if (part === "Alt" && isMac) return "Option";
      return part.replace(/^Key(?=[A-Z]$)/, "").replace(/^Digit(?=\d$)/, "");
    })
    .join("+");
}

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
}
