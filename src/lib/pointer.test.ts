import { describe, expect, it } from "vitest";
import {
  loadPointerModifier,
  modifierLabel,
  POINTER_MODIFIER_STORAGE_KEY,
  savePointerModifier
} from "./pointer";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    }
  };
}

describe("pointer modifier", () => {
  it("defaults to Alt / Option", () => {
    expect(loadPointerModifier(memoryStorage())).toBe("alt");
  });

  it("round-trips a saved choice and ignores unknown values", () => {
    const storage = memoryStorage();
    savePointerModifier("primary", storage);
    expect(loadPointerModifier(storage)).toBe("primary");
    expect(loadPointerModifier(memoryStorage({ [POINTER_MODIFIER_STORAGE_KEY]: "shift" }))).toBe(
      "alt"
    );
  });

  it("names the keys per platform", () => {
    expect(modifierLabel("alt", true)).toBe("Option");
    expect(modifierLabel("alt", false)).toBe("Alt");
    expect(modifierLabel("primary", true)).toBe("Cmd");
    expect(modifierLabel("primary", false)).toBe("Ctrl");
  });
});
