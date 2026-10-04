import { isMacPlatform } from "./shortcuts";

/** The key held with a click (open) or a drag (attach the dragged region). */
export type PointerModifier = "alt" | "primary";

export const DEFAULT_POINTER_MODIFIER: PointerModifier = "alt";
export const POINTER_MODIFIER_STORAGE_KEY = "clarity.pointerModifier.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function loadPointerModifier(storage: StorageLike = window.localStorage): PointerModifier {
  try {
    const value = storage.getItem(POINTER_MODIFIER_STORAGE_KEY);
    return value === "alt" || value === "primary" ? value : DEFAULT_POINTER_MODIFIER;
  } catch {
    return DEFAULT_POINTER_MODIFIER;
  }
}

export function savePointerModifier(
  modifier: PointerModifier,
  storage: StorageLike = window.localStorage
): void {
  try {
    storage.setItem(POINTER_MODIFIER_STORAGE_KEY, modifier);
  } catch {
    // Not persisting only means the default is used next launch.
  }
}

export function modifierLabel(modifier: PointerModifier, isMac = isMacPlatform()): string {
  if (modifier === "alt") return isMac ? "Option" : "Alt";
  return isMac ? "Cmd" : "Ctrl";
}
