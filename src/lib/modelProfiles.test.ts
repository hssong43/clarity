import { describe, expect, it } from "vitest";
import {
  ACTIVE_MODEL_PROFILE_ID_STORAGE_KEY,
  LEGACY_OPENAI_API_KEY_STORAGE_KEY,
  MODEL_PROFILES_STORAGE_KEY,
  createProfileDraft,
  createProfileFromDraft,
  getActiveProfile,
  loadProfileState,
  persistProfileState,
  providerConfigs,
  validateProfileDraft
} from "./modelProfiles";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("model profile storage", () => {
  it("migrates a legacy OpenAI key into a default profile", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_OPENAI_API_KEY_STORAGE_KEY, "sk-legacy");

    const state = loadProfileState(storage);

    expect(state.activeProfileId).toBe("legacy-openai-profile");
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]).toMatchObject({
      name: "OpenAI",
      provider: "openai",
      apiKey: "sk-legacy",
      model: providerConfigs.openai.defaultModel
    });
    expect(storage.getItem(LEGACY_OPENAI_API_KEY_STORAGE_KEY)).toBe("sk-legacy");
  });

  it("falls back to the first profile when the active profile is missing", () => {
    const storage = new MemoryStorage();
    const profiles = [
      {
        id: "one",
        name: "One",
        provider: "openai" as const,
        apiKey: "key-one",
        model: "gpt-4o-mini",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ];
    storage.setItem(MODEL_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
    storage.setItem(ACTIVE_MODEL_PROFILE_ID_STORAGE_KEY, "missing");

    const state = loadProfileState(storage);

    expect(state.activeProfileId).toBe("one");
    expect(getActiveProfile(state)?.id).toBe("one");
  });

  it("persists profile deletions and clears the active profile when empty", () => {
    const storage = new MemoryStorage();
    persistProfileState({ profiles: [], activeProfileId: null }, storage);

    expect(storage.getItem(MODEL_PROFILES_STORAGE_KEY)).toBe("[]");
    expect(storage.getItem(ACTIVE_MODEL_PROFILE_ID_STORAGE_KEY)).toBeNull();
  });

  it("creates profiles from drafts without validating key prefixes", () => {
    const draft = createProfileDraft(null);
    const profile = createProfileFromDraft(
      {
        ...draft,
        name: "Gemini",
        provider: "gemini",
        apiKey: "not-a-prefixed-key",
        model: "gemini-2.5-pro"
      },
      null,
      () => "new-id"
    );

    expect(validateProfileDraft(createProfileDraft(profile))).toBeNull();
    expect(profile).toMatchObject({
      id: "new-id",
      provider: "gemini",
      apiKey: "not-a-prefixed-key"
    });
  });

  it("exposes OpenRouter defaults for new provider profiles", () => {
    expect(providerConfigs.openrouter).toMatchObject({
      label: "OpenRouter",
      keyPlaceholder: "sk-or-v1-...",
      defaultModel: "openrouter/auto"
    });
    expect(providerConfigs.openrouter.modelOptions).toContain("openrouter/auto");
  });

  it("includes each provider's default model in its presets", () => {
    for (const config of Object.values(providerConfigs)) {
      expect(config.modelOptions).toContain(config.defaultModel);
    }
  });

  it("loads persisted OpenRouter profiles", () => {
    const storage = new MemoryStorage();
    const profiles = [
      {
        id: "router",
        name: "Router",
        provider: "openrouter" as const,
        apiKey: "sk-or-v1-test",
        model: "openrouter/auto",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ];
    storage.setItem(MODEL_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
    storage.setItem(ACTIVE_MODEL_PROFILE_ID_STORAGE_KEY, "router");

    const state = loadProfileState(storage);

    expect(state.activeProfileId).toBe("router");
    expect(getActiveProfile(state)).toMatchObject({
      provider: "openrouter",
      model: "openrouter/auto"
    });
  });
});
