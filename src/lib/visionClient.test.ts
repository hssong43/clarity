import { describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "./modelProfiles";
import type { VisionChatRequest } from "../types";
import {
  buildAnthropicHttpRequest,
  buildGeminiHttpRequest,
  buildOpenAIHttpRequest,
  buildOpenRouterHttpRequest,
  buildSystemPrompt,
  buildUserMessageText,
  createProviderStreamParser,
  extractAnthropicStopReason,
  extractAnthropicTextDelta,
  extractGeminiStopReason,
  extractGeminiTextDelta,
  extractOpenAIStopReason,
  extractOpenAITextDelta,
  extractOpenRouterStopReason,
  extractOpenRouterTextDelta,
  resolveProviderErrorMessage,
  streamVisionChat
} from "./visionClient";
import { streamNativeHttp } from "./tauri";

vi.mock("./tauri", () => ({
  streamNativeHttp: vi.fn(),
  isAbortError: (error: unknown) => error instanceof DOMException && error.name === "AbortError"
}));

const image = {
  mime: "image/jpeg" as const,
  dataUrl: `data:image/jpeg;base64,${"a".repeat(32)}`,
  width: 1200,
  height: 800,
  displayId: "1"
};

const textFile = {
  name: "notes.md",
  mime: "text/markdown",
  size: 42,
  text: "These are the extracted notes.",
  truncated: false
};

const textOnlyRequest: VisionChatRequest = {
  messages: [{ role: "user", content: "Hello, can you help me write a reply?" }]
};

const historyRequest: VisionChatRequest = {
  messages: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi. What are you working on?" },
    { role: "user", content: "What should I press on this screen?", images: [image] }
  ]
};

const fileHistoryRequest: VisionChatRequest = {
  messages: [
    { role: "user", content: "Remember this topic: onboarding" },
    { role: "assistant", content: "Got it." },
    { role: "user", content: "Use this file for the answer.", files: [textFile] }
  ]
};

const baseProfile: ModelProfile = {
  id: "profile-1",
  name: "Test",
  provider: "openai",
  apiKey: "test-key",
  model: "test-model",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("visionClient provider requests", () => {
  it("builds text-only OpenAI Responses requests without image blocks", () => {
    const nativeRequest = buildOpenAIHttpRequest(
      { apiKey: "sk-test", model: "gpt-4o-mini" },
      textOnlyRequest
    );
    const body = JSON.parse(nativeRequest.body) as {
      model: string;
      instructions: string;
      max_output_tokens: number;
      store: boolean;
      stream: boolean;
      input: Array<{ content: unknown[] }>;
    };

    expect(nativeRequest.url).toBe("https://api.openai.com/v1/responses");
    expect(nativeRequest.headers).toContainEqual(["Authorization", "Bearer sk-test"]);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.max_output_tokens).toBe(4096);
    expect(body.input[0].content).toEqual([
      { type: "input_text", text: "Hello, can you help me write a reply?" }
    ]);
    expect(nativeRequest.body).not.toContain("input_image");
    expect(body.instructions).toContain("Reply in the same language");
    expect(body.instructions).not.toContain("clear Korean");
  });

  it("attaches screenshots only to the latest OpenAI user message", () => {
    const nativeRequest = buildOpenAIHttpRequest(
      { apiKey: "sk-test", model: "gpt-4o-mini" },
      historyRequest
    );
    const body = JSON.parse(nativeRequest.body) as {
      input: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };

    expect(body.input.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(body.input[0].content.some((part) => part.type === "input_image")).toBe(false);
    expect(body.input[1].content).toEqual([
      { type: "output_text", text: "Hi. What are you working on?" }
    ]);
    expect(body.input[2].content[1]).toEqual({
      type: "input_image",
      image_url: image.dataUrl,
      detail: "low"
    });
  });

  it("builds Anthropic Messages requests with conversation history", () => {
    const nativeRequest = buildAnthropicHttpRequest(
      { apiKey: "sk-ant-test", model: "claude-sonnet-4-20250514" },
      historyRequest
    );
    const body = JSON.parse(nativeRequest.body) as {
      model: string;
      max_tokens: number;
      system: string;
      stream: boolean;
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };

    expect(nativeRequest.url).toBe("https://api.anthropic.com/v1/messages");
    expect(nativeRequest.headers).toContainEqual(["x-api-key", "sk-ant-test"]);
    expect(nativeRequest.headers).toContainEqual(["anthropic-version", "2023-06-01"]);
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(body.max_tokens).toBe(4096);
    expect(body.stream).toBe(true);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0].content).toEqual([{ type: "text", text: "Hello" }]);
    expect(body.messages[1].content).toEqual([
      { type: "text", text: "Hi. What are you working on?" }
    ]);
    expect(body.messages[2].content[0]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: "a".repeat(32)
      }
    });
    expect(body.system).toContain("current full-screen context");
    expect(body.system).not.toContain("clear Korean");
  });

  it("builds Gemini streaming requests with history and latest screenshot data", () => {
    const nativeRequest = buildGeminiHttpRequest(
      { apiKey: "AIza-test", model: "gemini-2.5-pro" },
      historyRequest
    );
    const body = JSON.parse(nativeRequest.body) as {
      generationConfig: { maxOutputTokens: number };
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
    };

    expect(nativeRequest.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse&key=AIza-test"
    );
    expect(body.generationConfig.maxOutputTokens).toBe(4096);
    expect(body.contents).toHaveLength(3);
    expect(body.contents[0].parts.some((part) => "inlineData" in part)).toBe(false);
    expect(body.contents[2].parts[1]).toEqual({
      inlineData: {
        mimeType: "image/jpeg",
        data: "a".repeat(32)
      }
    });
    expect(nativeRequest.body).toContain("Reply in the same language");
  });

  it("builds OpenRouter chat completion requests with history and screenshot data", () => {
    const nativeRequest = buildOpenRouterHttpRequest(
      { apiKey: "sk-or-v1-test", model: "openrouter/auto" },
      historyRequest
    );
    const body = JSON.parse(nativeRequest.body) as {
      model: string;
      max_tokens: number;
      stream: boolean;
      messages: Array<{
        role: string;
        content: string | Array<Record<string, unknown>>;
      }>;
    };

    expect(nativeRequest.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(nativeRequest.headers).toContainEqual(["Authorization", "Bearer sk-or-v1-test"]);
    expect(nativeRequest.headers).toContainEqual(["X-OpenRouter-Title", "Clarity"]);
    expect(body.model).toBe("openrouter/auto");
    expect(body.max_tokens).toBe(4096);
    expect(body.stream).toBe(true);
    expect(body.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user"
    ]);
    expect(body.messages[0].content).toContain("Reply in the same language");
    expect(body.messages[2].content).toBe("Hi. What are you working on?");
    expect(body.messages[3].content[1]).toEqual({
      type: "image_url",
      image_url: {
        url: image.dataUrl,
        detail: "low"
      }
    });
  });

  it("adds extracted file context only to the latest user message", () => {
    const nativeRequest = buildOpenAIHttpRequest(
      { apiKey: "sk-test", model: "gpt-4o-mini" },
      fileHistoryRequest
    );
    const body = JSON.parse(nativeRequest.body) as {
      instructions: string;
      input: Array<{ content: Array<{ text?: string; type: string }> }>;
    };

    expect(body.input[0].content[0].text).toBe("Remember this topic: onboarding");
    expect(body.input[1].content[0].text).toBe("Got it.");
    expect(body.input[2].content[0].text).toContain("Attached file context:");
    expect(body.input[2].content[0].text).toContain("--- notes.md ---");
    expect(body.input[2].content[0].text).toContain("These are the extracted notes.");
    expect(body.instructions).toContain("extracted file text");
  });

  it("formats truncated file context for provider payloads", () => {
    const text = buildUserMessageText({
      content: "Summarize this.",
      files: [{ ...textFile, size: 2048, truncated: true }]
    });

    expect(text).toContain("Summarize this.");
    expect(text).toContain("Size: 2.0 KB");
    expect(text).toContain("Truncated: yes");
  });

  it("uses a chat-first prompt that does not force Korean", () => {
    const prompt = buildSystemPrompt(textOnlyRequest);

    expect(prompt).toContain("helpful chat agent");
    expect(prompt).toContain("Reply in the same language");
    expect(prompt).toContain("do not reference screen contents");
    expect(prompt).not.toContain("clear Korean");
  });

  it("omits sampling params and enables refusal fallbacks for adaptive Claude models", () => {
    const nativeRequest = buildAnthropicHttpRequest(
      { apiKey: "sk-ant-test", model: "claude-sonnet-5-5" },
      historyRequest
    );
    const body = JSON.parse(nativeRequest.body) as Record<string, unknown>;

    expect(nativeRequest.headers).toContainEqual([
      "anthropic-beta",
      "server-side-fallback-2026-07-01"
    ]);
    expect(body).not.toHaveProperty("temperature");
    expect(body.max_tokens).toBe(16000);
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.fallbacks).toBe("default");
  });

  it("omits refusal fallbacks for Claude Sonnet 5", () => {
    const nativeRequest = buildAnthropicHttpRequest(
      { apiKey: "sk-ant-test", model: "claude-sonnet-5" },
      historyRequest
    );
    const body = JSON.parse(nativeRequest.body) as Record<string, unknown>;

    expect(nativeRequest.headers.map(([name]) => name)).not.toContain("anthropic-beta");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("fallbacks");
  });

  it("keeps temperature and no beta header for Claude Haiku 4.5", () => {
    const nativeRequest = buildAnthropicHttpRequest(
      { apiKey: "sk-ant-test", model: "claude-haiku-4-5" },
      historyRequest
    );
    const body = JSON.parse(nativeRequest.body) as Record<string, unknown>;

    expect(nativeRequest.headers.map(([name]) => name)).not.toContain("anthropic-beta");
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(4096);
    expect(body).not.toHaveProperty("output_config");
    expect(body).not.toHaveProperty("fallbacks");
  });

  it("uses reasoning effort instead of temperature for GPT-5 models", () => {
    const body = JSON.parse(
      buildOpenAIHttpRequest({ apiKey: "sk-test", model: "gpt-5.4-mini" }, historyRequest).body
    ) as Record<string, unknown>;

    expect(body).not.toHaveProperty("temperature");
    expect(body.reasoning).toEqual({ effort: "low" });
  });

  it("uses the default temperature for Gemini 3 models", () => {
    const body = JSON.parse(
      buildGeminiHttpRequest({ apiKey: "AIza-test", model: "gemini-3.8-flash" }, historyRequest)
        .body
    ) as { generationConfig: Record<string, unknown> };

    expect(body.generationConfig).not.toHaveProperty("temperature");
    expect(body.generationConfig.maxOutputTokens).toBe(4096);
  });
});

describe("visionClient provider stream parsing", () => {
  it("maps Anthropic refusals to content_filter", () => {
    expect(
      extractAnthropicStopReason({ type: "message_delta", delta: { stop_reason: "refusal" } })
    ).toEqual({ reason: "content_filter", message: "Anthropic stopped because refusal." });
  });

  it("extracts OpenAI text deltas", () => {
    expect(extractOpenAITextDelta({ type: "response.output_text.delta", delta: "hello" })).toBe(
      "hello"
    );
  });

  it("extracts Anthropic text deltas", () => {
    expect(
      extractAnthropicTextDelta({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hello" }
      })
    ).toBe("hello");
  });

  it("extracts Gemini text deltas", () => {
    expect(
      extractGeminiTextDelta({
        candidates: [{ content: { parts: [{ text: "hel" }, { text: "lo" }] } }]
      })
    ).toBe("hello");
  });

  it("extracts OpenRouter chat completion text deltas", () => {
    expect(
      extractOpenRouterTextDelta({
        choices: [{ delta: { content: "hel" } }, { delta: { content: "lo" } }]
      })
    ).toBe("hello");
  });

  it("extracts provider length stop reasons", () => {
    expect(
      extractOpenAIStopReason({
        type: "response.incomplete",
        response: { incomplete_details: { reason: "max_output_tokens" } }
      })
    ).toMatchObject({ reason: "length" });
    expect(
      extractAnthropicStopReason({
        type: "message_delta",
        delta: { stop_reason: "max_tokens" }
      })
    ).toMatchObject({ reason: "length" });
    expect(
      extractGeminiStopReason({
        candidates: [{ finishReason: "MAX_TOKENS" }]
      })
    ).toMatchObject({ reason: "length" });
    expect(
      extractOpenRouterStopReason({
        choices: [{ finish_reason: "length" }]
      })
    ).toMatchObject({ reason: "length" });
  });

  it("normalizes provider SSE chunks", () => {
    const seen: string[] = [];
    const parser = createProviderStreamParser("anthropic", (event) => {
      seen.push(event.type === "delta" ? event.text : event.type);
    });

    parser.push(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"A"}}\n\n'
    );
    parser.push(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"B"}}\n\n'
    );
    parser.finish();

    expect(seen).toEqual(["A", "B", "done"]);
  });

  it("emits done with a normalized length reason", () => {
    const seen: string[] = [];
    const parser = createProviderStreamParser("anthropic", (event) => {
      seen.push(event.type === "done" ? event.reason : event.type);
    });

    parser.push(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"A"}}\n\n'
    );
    parser.push(
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n'
    );
    parser.finish();

    expect(seen).toEqual(["delta", "length"]);
  });

  it("normalizes OpenRouter SSE chunks", () => {
    const seen: string[] = [];
    const parser = createProviderStreamParser("openrouter", (event) => {
      seen.push(event.type === "delta" ? event.text : event.type);
    });

    parser.push('data: {"choices":[{"delta":{"content":"A"}}]}\n\n');
    parser.push('data: {"choices":[{"delta":{"content":"B"}}]}\n\n');
    parser.finish();

    expect(seen).toEqual(["A", "B", "done"]);
  });
});

describe("streamVisionChat", () => {
  it("uses the native HTTP bridge and normalizes streamed chunks", async () => {
    vi.mocked(streamNativeHttp).mockImplementation(async (_request, onChunk) => {
      onChunk('data: {"type":"response.output_text.delta","delta":"A"}\n\n');
      onChunk('data: {"type":"response.output_text.delta","delta":"B"}\n\n');
    });

    const seen: string[] = [];
    await streamVisionChat({
      profile: { ...baseProfile, provider: "openai", apiKey: "sk-test", model: "gpt-4o-mini" },
      request: textOnlyRequest,
      onEvent(event) {
        seen.push(event.type === "delta" ? event.text : event.type);
      }
    });

    expect(streamNativeHttp).toHaveBeenCalledOnce();
    expect(seen).toEqual(["A", "B", "done"]);
  });

  it("rethrows cancellations without wrapping them as provider errors", async () => {
    const abortError = new DOMException("The request was cancelled.", "AbortError");
    vi.mocked(streamNativeHttp).mockRejectedValueOnce(abortError);

    await expect(
      streamVisionChat({
        profile: { ...baseProfile, provider: "openai", apiKey: "sk-test", model: "gpt-4o-mini" },
        request: textOnlyRequest,
        onEvent: () => undefined
      })
    ).rejects.toBe(abortError);
  });

  it("uses provider error messages when requests fail", async () => {
    const message = resolveProviderErrorMessage(
      "gemini",
      new Error('HTTP 400: {"error":{"message":"API key not valid"}}')
    );

    expect(message).toBe("API key not valid");
  });

  it("uses OpenRouter provider error messages when requests fail", async () => {
    const message = resolveProviderErrorMessage(
      "openrouter",
      new Error('HTTP 401: {"error":{"message":"No auth credentials found"}}')
    );

    expect(message).toBe("No auth credentials found");
  });
});
