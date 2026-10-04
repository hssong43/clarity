export type CaptureArea = "full" | "region";
export type CaptureShortcuts = Record<CaptureArea, string>;

export const DEFAULT_CAPTURE_SHORTCUT = "CommandOrControl+Shift+Space";
export const DEFAULT_REGION_SHORTCUT = "Alt+Shift+Space";
export const DEFAULT_SHORTCUTS: CaptureShortcuts = {
  full: DEFAULT_CAPTURE_SHORTCUT,
  region: DEFAULT_REGION_SHORTCUT
};

export const CAPTURE_SHORTCUT_STORAGE_KEY = "clarity.captureShortcut.v1";
export const REGION_SHORTCUT_STORAGE_KEY = "clarity.regionShortcut.v1";
const STORAGE_KEYS: CaptureShortcuts = {
  full: CAPTURE_SHORTCUT_STORAGE_KEY,
  region: REGION_SHORTCUT_STORAGE_KEY
};

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

/** Returns each saved shortcut, "" when disabled, or its default. */
export function loadCaptureShortcuts(storage: StorageLike = window.localStorage): CaptureShortcuts {
  const load = (area: CaptureArea) => {
    try {
      return storage.getItem(STORAGE_KEYS[area]) ?? DEFAULT_SHORTCUTS[area];
    } catch {
      return DEFAULT_SHORTCUTS[area];
    }
  };
  return { full: load("full"), region: load("region") };
}

export function saveCaptureShortcut(
  area: CaptureArea,
  shortcut: string,
  storage: StorageLike = window.localStorage
): void {
  try {
    storage.setItem(STORAGE_KEYS[area], shortcut);
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

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
}
