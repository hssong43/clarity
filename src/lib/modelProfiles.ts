export type ProviderId = "openai" | "anthropic" | "gemini" | "openrouter";

export type ModelProfile = {
  id: string;
  name: string;
  provider: ProviderId;
  apiKey: string;
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
    defaultModel: "gpt-4o-mini",
    modelOptions: ["gpt-4o-mini", "gpt-5-mini", "gpt-5.2", "gpt-4.1"]
  },
  anthropic: {
    label: "Claude",
    keyPlaceholder: "sk-ant-...",
    defaultModel: "claude-sonnet-4-20250514",
    modelOptions: [
      "claude-sonnet-4-20250514",
      "claude-opus-4-1-20250805",
      "claude-3-5-haiku-20241022"
    ]
  },
  gemini: {
    label: "Gemini",
    keyPlaceholder: "AIza...",
    defaultModel: "gemini-2.5-pro",
    modelOptions: ["gemini-2.5-pro"]
  },
  openrouter: {
    label: "OpenRouter",
    keyPlaceholder: "sk-or-v1-...",
    defaultModel: "openrouter/auto",
    modelOptions: ["openrouter/auto", "openai/gpt-5.2", "anthropic/claude-sonnet-4"]
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
      model: profile.model
    };
  }

  return {
    id: null,
    name: providerConfigs.openai.label,
    provider: "openai",
    apiKey: "",
    model: providerConfigs.openai.defaultModel
  };
}

export function createProfileFromDraft(
  draft: ProfileDraft,
  existing?: ModelProfile | null,
  createId = defaultCreateId
): ModelProfile {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? draft.id ?? createId(),
    name: draft.name.trim(),
    provider: draft.provider,
    apiKey: draft.apiKey.trim(),
    model: draft.model.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

export function validateProfileDraft(draft: ProfileDraft): string | null {
  if (!draft.name.trim()) return "Enter a profile name.";
  if (!draft.apiKey.trim()) return "Enter an API key.";
  if (!draft.model.trim()) return "Enter a model ID.";
  return null;
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
