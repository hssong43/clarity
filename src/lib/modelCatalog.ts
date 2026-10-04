import type { ProviderId } from "./modelProfiles";
import { streamNativeHttp, type NativeAuthScheme, type NativeHttpRequest } from "./tauri";

export type ModelCatalogCredentials = {
  apiKey: string;
  /** The key lives in the OS keychain under this profile id. */
  storedKeyProfileId?: string | null;
};

const SCHEMES: Record<ProviderId, NativeAuthScheme> = {
  openai: "bearer",
  anthropic: "xApiKey",
  gemini: "xGoogApiKey",
  openrouter: "bearer"
};

const HEADER_NAMES: Record<NativeAuthScheme, string> = {
  bearer: "Authorization",
  xApiKey: "x-api-key",
  xGoogApiKey: "x-goog-api-key"
};

export function buildModelListRequest(
  provider: ProviderId,
  credentials: ModelCatalogCredentials
): NativeHttpRequest {
  const scheme = SCHEMES[provider];
  const headers: Array<[string, string]> =
    provider === "anthropic" ? [["anthropic-version", "2023-06-01"]] : [];
  const url = {
    openai: "https://api.openai.com/v1/models",
    anthropic: "https://api.anthropic.com/v1/models?limit=1000",
    gemini: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    openrouter: "https://openrouter.ai/api/v1/models"
  }[provider];

  const apiKey = credentials.apiKey.trim();
  if (!apiKey && credentials.storedKeyProfileId) {
    return {
      method: "GET",
      url,
      headers,
      body: "",
      auth: { profileId: credentials.storedKeyProfileId, scheme }
    };
  }

  headers.push([HEADER_NAMES[scheme], scheme === "bearer" ? `Bearer ${apiKey}` : apiKey]);
  return { method: "GET", url, headers, body: "" };
}

const OPENAI_CHAT_ID = /^(gpt-|chatgpt-|o\d)/;
const OPENAI_EXCLUDED =
  /(embedding|tts|whisper|transcribe|dall-e|image|audio|realtime|moderation|search-preview|instruct)/;

/** Turns a provider's model-list response into sorted, chat-capable model IDs. */
export function parseModelList(provider: ProviderId, json: unknown): string[] {
  const root = (json ?? {}) as { data?: unknown; models?: unknown };
  let ids: string[];

  if (provider === "gemini") {
    const models = Array.isArray(root.models) ? root.models : [];
    ids = models
      .filter((item: { supportedGenerationMethods?: string[] }) =>
        item?.supportedGenerationMethods?.some(
          (method) => method === "generateContent" || method === "streamGenerateContent"
        )
      )
      .map((item: { name?: unknown }) => String(item?.name ?? "").replace(/^models\//, ""));
  } else {
    const data = Array.isArray(root.data) ? root.data : [];
    ids = data.map((item: { id?: unknown }) => String(item?.id ?? ""));
    if (provider === "openai") {
      ids = ids.filter((id) => OPENAI_CHAT_ID.test(id) && !OPENAI_EXCLUDED.test(id));
    }
  }

  return [...new Set(ids.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export async function fetchProviderModels(
  provider: ProviderId,
  credentials: ModelCatalogCredentials,
  signal?: AbortSignal
): Promise<string[]> {
  let text = "";
  await streamNativeHttp(
    buildModelListRequest(provider, credentials),
    (chunk) => {
      text += chunk;
    },
    signal
  );

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The provider returned an unreadable model list.");
  }
  const models = parseModelList(provider, json);
  if (models.length === 0) {
    throw new Error("No models were returned for this key.");
  }
  return models;
}
