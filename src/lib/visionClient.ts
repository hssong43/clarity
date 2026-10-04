import type { ModelProfile, ProviderId } from "./modelProfiles";
import type { NativeHttpRequest } from "./tauri";
import { streamNativeHttp } from "./tauri";
import { formatBytes } from "./attachments";
import type {
  ChatImageAttachment,
  StreamEvent,
  StreamStopReason,
  TextAttachment,
  VisionChatRequest
} from "../types";

export type StreamVisionChatOptions = {
  profile: ModelProfile;
  request: VisionChatRequest;
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
};

type ProviderStreamParser = {
  push: (chunk: string) => void;
  finish: () => void;
};

const MAX_OUTPUT_TOKENS = 4096;

export async function streamVisionChat({
  profile,
  request,
  signal,
  onEvent
}: StreamVisionChatOptions): Promise<void> {
  const parser = createProviderStreamParser(profile.provider, onEvent);

  try {
    await streamNativeHttp(
      buildProviderHttpRequest(profile, request),
      (chunk) => {
        parser.push(chunk);
      },
      signal
    );
    parser.finish();
  } catch (error) {
    throw new Error(resolveProviderErrorMessage(profile.provider, error), { cause: error });
  }
}

export function buildProviderHttpRequest(
  profile: ModelProfile,
  request: VisionChatRequest
): NativeHttpRequest {
  switch (profile.provider) {
    case "openai":
      return buildOpenAIHttpRequest(profile, request);
    case "anthropic":
      return buildAnthropicHttpRequest(profile, request);
    case "gemini":
      return buildGeminiHttpRequest(profile, request);
    case "openrouter":
      return buildOpenRouterHttpRequest(profile, request);
  }
}

export function buildOpenAIHttpRequest(
  profile: Pick<ModelProfile, "apiKey" | "model">,
  request: VisionChatRequest
): NativeHttpRequest {
  return {
    method: "POST",
    url: "https://api.openai.com/v1/responses",
    headers: [
      ["Content-Type", "application/json"],
      ["Authorization", `Bearer ${profile.apiKey}`]
    ],
    body: JSON.stringify(buildOpenAIResponsesPayload(profile.model, request))
  };
}

export function buildAnthropicHttpRequest(
  profile: Pick<ModelProfile, "apiKey" | "model">,
  request: VisionChatRequest
): NativeHttpRequest {
  return {
    method: "POST",
    url: "https://api.anthropic.com/v1/messages",
    headers: [
      ["Content-Type", "application/json"],
      ["x-api-key", profile.apiKey],
      ["anthropic-version", "2023-06-01"]
    ],
    body: JSON.stringify(buildAnthropicMessagesPayload(profile.model, request))
  };
}

export function buildGeminiHttpRequest(
  profile: Pick<ModelProfile, "apiKey" | "model">,
  request: VisionChatRequest
): NativeHttpRequest {
  return {
    method: "POST",
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      profile.model
    )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(profile.apiKey)}`,
    headers: [["Content-Type", "application/json"]],
    body: JSON.stringify(buildGeminiGenerateContentPayload(request))
  };
}

export function buildOpenRouterHttpRequest(
  profile: Pick<ModelProfile, "apiKey" | "model">,
  request: VisionChatRequest
): NativeHttpRequest {
  return {
    method: "POST",
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: [
      ["Content-Type", "application/json"],
      ["Authorization", `Bearer ${profile.apiKey}`],
      ["X-OpenRouter-Title", "Clarity"]
    ],
    body: JSON.stringify(buildOpenRouterChatCompletionsPayload(profile.model, request))
  };
}

export function buildOpenAIResponsesPayload(model: string, request: VisionChatRequest) {
  return {
    model,
    instructions: buildSystemPrompt(request),
    store: false,
    stream: true,
    stream_options: {
      include_obfuscation: false
    },
    temperature: 0.2,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    input: request.messages.map((message) => ({
      role: message.role,
      content:
        message.role === "assistant"
          ? [
              {
                type: "output_text",
                text: message.content
              }
            ]
          : [
              {
                type: "input_text",
                text: buildUserMessageText(message)
              },
              ...(message.images ?? []).map((image) => ({
                type: "input_image",
                image_url: image.dataUrl,
                detail: "low"
              }))
            ]
    }))
  };
}

export function buildAnthropicMessagesPayload(model: string, request: VisionChatRequest) {
  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    stream: true,
    system: buildSystemPrompt(request),
    messages: request.messages.map((message) => ({
      role: message.role,
      content:
        message.role === "assistant"
          ? [{ type: "text", text: message.content }]
          : [
              ...(message.images ?? []).map((image) => ({
                type: "image",
                source: {
                  type: "base64",
                  media_type: image.mime,
                  data: stripDataUrl(image)
                }
              })),
              {
                type: "text",
                text: buildUserMessageText(message)
              }
            ]
    }))
  };
}

export function buildGeminiGenerateContentPayload(request: VisionChatRequest) {
  return {
    systemInstruction: {
      parts: [{ text: buildSystemPrompt(request) }]
    },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS
    },
    contents: request.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts:
        message.role === "assistant"
          ? [{ text: message.content }]
          : [
              { text: buildUserMessageText(message) },
              ...(message.images ?? []).map((image) => ({
                inlineData: {
                  mimeType: image.mime,
                  data: stripDataUrl(image)
                }
              }))
            ]
    }))
  };
}

export function buildOpenRouterChatCompletionsPayload(model: string, request: VisionChatRequest) {
  return {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(request) },
      ...request.messages.map((message) => ({
        role: message.role,
        content:
          message.role === "assistant"
            ? message.content
            : [
                { type: "text", text: buildUserMessageText(message) },
                ...(message.images ?? []).map((image) => ({
                  type: "image_url",
                  image_url: {
                    url: image.dataUrl,
                    detail: "low"
                  }
                }))
              ]
      }))
    ],
    stream: true,
    temperature: 0.2,
    max_tokens: MAX_OUTPUT_TOKENS
  };
}

export function buildSystemPrompt(request: VisionChatRequest): string {
  const latestUserMessage = [...request.messages]
    .reverse()
    .find((message) => message.role === "user");
  const hasAttachedScreen = (latestUserMessage?.images?.length ?? 0) > 0;
  const hasAttachedFiles = (latestUserMessage?.files?.length ?? 0) > 0;
  return [
    "You are Clarity, a helpful chat agent.",
    "Reply in the same language the user uses unless they ask for a different language.",
    "Do not claim to see the user's screen unless the latest user message includes attached screenshots.",
    hasAttachedScreen
      ? "When screenshots are attached, treat them as current full-screen context and ground screen-specific answers in visible evidence."
      : "If no screenshots are attached, do not reference screen contents.",
    hasAttachedFiles
      ? "When files are attached, use the extracted file text as context for the latest user message."
      : "If no files are attached, answer from the conversation without implying access to local files.",
    "Do not repeat sensitive-looking information verbatim unless it is necessary."
  ].join(" ");
}

export function buildUserMessageText(message: {
  content: string;
  files?: TextAttachment[];
}): string {
  const files = message.files?.filter((file) => file.text.trim()) ?? [];
  if (files.length === 0) {
    return message.content;
  }

  return [
    message.content,
    "",
    "Attached file context:",
    ...files.map(formatAttachedFileContext)
  ].join("\n");
}

export function createProviderStreamParser(
  provider: ProviderId,
  onEvent: (event: StreamEvent) => void
): ProviderStreamParser {
  let buffer = "";
  let stopReason: StreamStopReason = "complete";
  let stopMessage: string | undefined;

  return {
    push(chunk: string) {
      buffer += chunk;
      buffer = drainSsePackets(buffer, provider, onEvent, (reason, message) => {
        stopReason = reason;
        stopMessage = message;
      });
    },
    finish() {
      buffer = drainSsePackets(
        buffer,
        provider,
        onEvent,
        (reason, message) => {
          stopReason = reason;
          stopMessage = message;
        },
        true
      );
      onEvent({ type: "done", reason: stopReason, message: stopMessage });
    }
  };
}

export function parseProviderSsePacket(provider: ProviderId, packet: string): StreamEvent[] {
  const parsed = parseProviderSsePayload(packet);
  if (!parsed) {
    return [];
  }

  const text = extractProviderTextDelta(provider, parsed);
  return text ? [{ type: "delta", text }] : [];
}

export function parseProviderSsePayload(packet: string): unknown | null {
  const data = extractSseData(packet);
  if (!data || data === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

export function extractProviderTextDelta(provider: ProviderId, event: unknown): string {
  switch (provider) {
    case "openai":
      return extractOpenAITextDelta(event);
    case "anthropic":
      return extractAnthropicTextDelta(event);
    case "gemini":
      return extractGeminiTextDelta(event);
    case "openrouter":
      return extractOpenRouterTextDelta(event);
  }
}

export function extractProviderStopReason(
  provider: ProviderId,
  event: unknown
): { reason: StreamStopReason; message?: string } | null {
  switch (provider) {
    case "openai":
      return extractOpenAIStopReason(event);
    case "anthropic":
      return extractAnthropicStopReason(event);
    case "gemini":
      return extractGeminiStopReason(event);
    case "openrouter":
      return extractOpenRouterStopReason(event);
  }
}

export function extractOpenAITextDelta(event: unknown): string {
  if (!isRecord(event)) {
    return "";
  }

  if (event.type === "response.output_text.delta") {
    if (typeof event.delta === "string") return event.delta;
    if (typeof event.text === "string") return event.text;
  }

  if (event.type === "response.refusal.delta" && typeof event.delta === "string") {
    return event.delta;
  }

  return "";
}

export function extractAnthropicTextDelta(event: unknown): string {
  if (!isRecord(event) || event.type !== "content_block_delta" || !isRecord(event.delta)) {
    return "";
  }

  if (event.delta.type === "text_delta" && typeof event.delta.text === "string") {
    return event.delta.text;
  }

  return "";
}

export function extractGeminiTextDelta(event: unknown): string {
  if (!isRecord(event) || !Array.isArray(event.candidates)) {
    return "";
  }

  return event.candidates
    .map((candidate) => {
      if (
        !isRecord(candidate) ||
        !isRecord(candidate.content) ||
        !Array.isArray(candidate.content.parts)
      ) {
        return "";
      }
      return candidate.content.parts
        .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
        .join("");
    })
    .join("");
}

export function extractOpenRouterTextDelta(event: unknown): string {
  if (!isRecord(event) || !Array.isArray(event.choices)) {
    return "";
  }

  return event.choices
    .map((choice) => {
      if (!isRecord(choice) || !isRecord(choice.delta)) {
        return "";
      }
      return typeof choice.delta.content === "string" ? choice.delta.content : "";
    })
    .join("");
}

export function extractOpenAIStopReason(
  event: unknown
): { reason: StreamStopReason; message?: string } | null {
  if (!isRecord(event)) {
    return null;
  }

  if (event.type === "response.incomplete" && isRecord(event.response)) {
    const details = isRecord(event.response.incomplete_details)
      ? event.response.incomplete_details
      : null;
    const reason = typeof details?.reason === "string" ? details.reason : "";
    return {
      reason: normalizeOpenAIStopReason(reason),
      message: reason ? `OpenAI stopped because ${reason}.` : undefined
    };
  }

  if (event.type === "response.completed" && isRecord(event.response)) {
    if (event.response.status === "incomplete") {
      const details = isRecord(event.response.incomplete_details)
        ? event.response.incomplete_details
        : null;
      const reason = typeof details?.reason === "string" ? details.reason : "";
      return {
        reason: normalizeOpenAIStopReason(reason),
        message: reason ? `OpenAI stopped because ${reason}.` : undefined
      };
    }

    return { reason: "complete" };
  }

  return null;
}

export function extractAnthropicStopReason(
  event: unknown
): { reason: StreamStopReason; message?: string } | null {
  if (!isRecord(event) || event.type !== "message_delta" || !isRecord(event.delta)) {
    return null;
  }

  const reason = typeof event.delta.stop_reason === "string" ? event.delta.stop_reason : "";
  if (!reason) {
    return null;
  }

  return {
    reason: normalizeAnthropicStopReason(reason),
    message: `Anthropic stopped because ${reason}.`
  };
}

export function extractGeminiStopReason(
  event: unknown
): { reason: StreamStopReason; message?: string } | null {
  if (!isRecord(event) || !Array.isArray(event.candidates)) {
    return null;
  }

  const rawReason = event.candidates
    .map((candidate) =>
      isRecord(candidate) && typeof candidate.finishReason === "string"
        ? candidate.finishReason
        : ""
    )
    .find(Boolean);

  if (!rawReason) {
    return null;
  }

  return {
    reason: normalizeGeminiStopReason(rawReason),
    message: `Gemini stopped because ${rawReason}.`
  };
}

export function extractOpenRouterStopReason(
  event: unknown
): { reason: StreamStopReason; message?: string } | null {
  if (!isRecord(event) || !Array.isArray(event.choices)) {
    return null;
  }

  const rawReason = event.choices
    .map((choice) =>
      isRecord(choice) && typeof choice.finish_reason === "string" ? choice.finish_reason : ""
    )
    .find(Boolean);

  if (!rawReason) {
    return null;
  }

  return {
    reason: normalizeOpenRouterStopReason(rawReason),
    message: rawReason === "stop" ? undefined : `OpenRouter stopped because ${rawReason}.`
  };
}

export function resolveProviderErrorMessage(provider: ProviderId, error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const jsonStart = rawMessage.indexOf("{");

  if (jsonStart >= 0) {
    try {
      const payload = JSON.parse(rawMessage.slice(jsonStart)) as unknown;
      const parsed = extractProviderErrorMessage(provider, payload);
      if (parsed) return parsed;
    } catch {
      // Keep the raw transport error below.
    }
  }

  return rawMessage || "The request failed.";
}

function extractProviderErrorMessage(provider: ProviderId, payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  if (provider === "openai" && isRecord(payload.error)) {
    return typeof payload.error.message === "string" ? payload.error.message : null;
  }

  if (provider === "anthropic" && isRecord(payload.error)) {
    return typeof payload.error.message === "string" ? payload.error.message : null;
  }

  if (provider === "gemini" && isRecord(payload.error)) {
    return typeof payload.error.message === "string" ? payload.error.message : null;
  }

  if (provider === "openrouter" && isRecord(payload.error)) {
    return typeof payload.error.message === "string" ? payload.error.message : null;
  }

  return typeof payload.message === "string" ? payload.message : null;
}

function drainSsePackets(
  buffer: string,
  provider: ProviderId,
  onEvent: (event: StreamEvent) => void,
  onStopReason: (reason: StreamStopReason, message?: string) => void,
  flush = false
): string {
  let remaining = buffer;
  let separatorIndex = findSeparator(remaining);

  while (separatorIndex >= 0) {
    const packet = remaining.slice(0, separatorIndex);
    const parsed = parseProviderSsePayload(packet);
    if (parsed) {
      const stop = extractProviderStopReason(provider, parsed);
      if (stop) {
        onStopReason(stop.reason, stop.message);
      }

      const text = extractProviderTextDelta(provider, parsed);
      if (text) {
        onEvent({ type: "delta", text });
      }
    }

    const separatorLength = remaining.startsWith("\r\n\r\n", separatorIndex) ? 4 : 2;
    remaining = remaining.slice(separatorIndex + separatorLength);
    separatorIndex = findSeparator(remaining);
  }

  if (flush && remaining.trim()) {
    const parsed = parseProviderSsePayload(remaining);
    if (parsed) {
      const stop = extractProviderStopReason(provider, parsed);
      if (stop) {
        onStopReason(stop.reason, stop.message);
      }

      const text = extractProviderTextDelta(provider, parsed);
      if (text) {
        onEvent({ type: "delta", text });
      }
    }
    return "";
  }

  return remaining;
}

function extractSseData(packet: string): string {
  return packet
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
}

function findSeparator(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}

function formatAttachedFileContext(file: TextAttachment): string {
  return [
    `--- ${file.name} ---`,
    `Type: ${file.mime || "unknown"}`,
    `Size: ${formatBytes(file.size)}`,
    `Truncated: ${file.truncated ? "yes" : "no"}`,
    file.text
  ].join("\n");
}

function normalizeOpenAIStopReason(reason: string): StreamStopReason {
  if (reason === "max_output_tokens") return "length";
  if (reason === "content_filter") return "content_filter";
  if (reason === "tool_calls") return "tool_use";
  return reason ? "unknown" : "complete";
}

function normalizeAnthropicStopReason(reason: string): StreamStopReason {
  if (reason === "max_tokens") return "length";
  if (reason === "stop_sequence" || reason === "end_turn") return "complete";
  if (reason === "tool_use") return "tool_use";
  return reason ? "unknown" : "complete";
}

function normalizeGeminiStopReason(reason: string): StreamStopReason {
  const normalized = reason.toUpperCase();
  if (normalized === "MAX_TOKENS") return "length";
  if (normalized === "STOP") return "complete";
  if (normalized === "SAFETY" || normalized === "RECITATION") return "content_filter";
  return reason ? "unknown" : "complete";
}

function normalizeOpenRouterStopReason(reason: string): StreamStopReason {
  if (reason === "length") return "length";
  if (reason === "content_filter") return "content_filter";
  if (reason === "tool_calls") return "tool_use";
  if (reason === "error") return "error";
  if (reason === "stop") return "complete";
  return reason ? "unknown" : "complete";
}

function stripDataUrl(image: ChatImageAttachment): string {
  return image.dataUrl.slice(`data:${image.mime};base64,`.length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
