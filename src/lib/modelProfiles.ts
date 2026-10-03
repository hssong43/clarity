export type ProviderId = "openai" | "anthropic" | "gemini" | "openrouter";

export type ModelProfile = {
  id: string;
  name: string;
  provider: ProviderId;
  /** Empty when the key lives in the OS keychain (`keyStorage: "keychain"`). */
  apiKey: string;
  keyStorage?: "keychain";
  model: string;
  createdAt: string;
  updatedAt: string;
};

export type ProfileState = {
  profiles: ModelProfile[];
  activeProfileId: string | null;
};

export type ProfileDraft = {
  id: string | null;
  name: string;
  provider: ProviderId;
  apiKey: string;
  /** The profile already has a key in the OS keychain; leaving apiKey blank keeps it. */
  hasStoredKey: boolean;
  model: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const LEGACY_OPENAI_API_KEY_STORAGE_KEY = "clarity.openai.apiKey.v1";
export const MODEL_PROFILES_STORAGE_KEY = "clarity.modelProfiles.v1";
export const ACTIVE_MODEL_PROFILE_ID_STORAGE_KEY = "clarity.activeModelProfileId.v1";

export const providerConfigs: Record<
  ProviderId,
  {
    label: string;
    keyPlaceholder: string;
    defaultModel: string;
    modelOptions: string[];
  }
> = {
  openai: {
    label: "OpenAI",
    keyPlaceholder: "sk-...",
    defaultModel: "gpt-5.4-mini",
    modelOptions: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"]
  },
  anthropic: {
    label: "Claude",
    keyPlaceholder: "sk-ant-...",
    defaultModel: "claude-sonnet-5-5",
    modelOptions: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5"]
  },
  gemini: {
    label: "Gemini",
    keyPlaceholder: "AIza...",
    defaultModel: "gemini-3.8-flash",
    modelOptions: ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview"]
  },
  openrouter: {
    label: "OpenRouter",
    keyPlaceholder: "sk-or-v1-...",
    defaultModel: "openrouter/auto",
    modelOptions: ["openrouter/auto", "anthropic/claude-sonnet-5.5", "openai/gpt-5.4-mini"]
  }
};

export const providerIds = Object.keys(providerConfigs) as ProviderId[];

export function loadProfileState(storage: StorageLike = window.localStorage): ProfileState {
  const profiles = readProfiles(storage);
  const activeProfileId = readActiveProfileId(storage, profiles);

  if (profiles.length > 0) {
    persistProfileState({ profiles, activeProfileId }, storage);
    return { profiles, activeProfileId };
  }

  const legacyKey = storage.getItem(LEGACY_OPENAI_API_KEY_STORAGE_KEY)?.trim();
  if (!legacyKey) {
    return { profiles: [], activeProfileId: null };
  }

  const now = new Date().toISOString();
  const migrated: ModelProfile = {
    id: "legacy-openai-profile",
    name: "OpenAI",
    provider: "openai",
    apiKey: legacyKey,
    model: providerConfigs.openai.defaultModel,
    createdAt: now,
    updatedAt: now
  };

  const migratedState = { profiles: [migrated], activeProfileId: migrated.id };
  persistProfileState(migratedState, storage);
  return migratedState;
}

export function persistProfileState(
  state: ProfileState,
  storage: StorageLike = window.localStorage
): void {
  storage.setItem(MODEL_PROFILES_STORAGE_KEY, JSON.stringify(state.profiles));
  if (state.activeProfileId) {
    storage.setItem(ACTIVE_MODEL_PROFILE_ID_STORAGE_KEY, state.activeProfileId);
  } else {
    storage.removeItem(ACTIVE_MODEL_PROFILE_ID_STORAGE_KEY);
  }
}

export function getActiveProfile(state: ProfileState): ModelProfile | null {
  return (
    state.profiles.find((profile) => profile.id === state.activeProfileId) ??
    state.profiles[0] ??
    null
  );
}

export function createProfileDraft(profile?: ModelProfile | null): ProfileDraft {
  if (profile) {
    return {
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      apiKey: profile.apiKey,
      hasStoredKey: profile.keyStorage === "keychain",
      model: profile.model
    };
  }

  return {
    id: null,
    name: providerConfigs.openai.label,
    provider: "openai",
    apiKey: "",
    hasStoredKey: false,
    model: providerConfigs.openai.defaultModel
  };
}

export function createProfileFromDraft(
  draft: ProfileDraft,
  existing?: ModelProfile | null,
  createId = defaultCreateId
): ModelProfile {
  const now = new Date().toISOString();
  const apiKey = draft.apiKey.trim();
  const keepStoredKey = !apiKey && existing?.keyStorage === "keychain";
  return {
    id: existing?.id ?? draft.id ?? createId(),
    name: draft.name.trim(),
    provider: draft.provider,
    apiKey,
    ...(keepStoredKey ? { keyStorage: "keychain" as const } : {}),
    model: draft.model.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

export function validateProfileDraft(draft: ProfileDraft): string | null {
  if (!draft.name.trim()) return "Enter a profile name.";
  if (!draft.apiKey.trim() && !draft.hasStoredKey) return "Enter an API key.";
  if (!draft.model.trim()) return "Enter a model ID.";
  return null;
}

export function hasUsableKey(profile: ModelProfile): boolean {
  return profile.keyStorage === "keychain" || Boolean(profile.apiKey);
}

export function defaultProfileName(provider: ProviderId): string {
  return providerConfigs[provider].label;
}

function readProfiles(storage: StorageLike): ModelProfile[] {
  try {
    const raw = storage.getItem(MODEL_PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isModelProfile);
  } catch {
    return [];
  }
}

function readActiveProfileId(storage: StorageLike, profiles: ModelProfile[]): string | null {
  const storedId = storage.getItem(ACTIVE_MODEL_PROFILE_ID_STORAGE_KEY);
  if (storedId && profiles.some((profile) => profile.id === storedId)) {
    return storedId;
  }
  return profiles[0]?.id ?? null;
}

function isModelProfile(value: unknown): value is ModelProfile {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isProviderId(value.provider) &&
    typeof value.apiKey === "string" &&
    (value.keyStorage === undefined || value.keyStorage === "keychain") &&
    typeof value.model === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isProviderId(value: unknown): value is ProviderId {
  return (
    value === "openai" || value === "anthropic" || value === "gemini" || value === "openrouter"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultCreateId(): string {
  return crypto.randomUUID();
}
