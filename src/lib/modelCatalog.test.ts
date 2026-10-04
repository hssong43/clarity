import { describe, expect, it } from "vitest";
import { buildModelListRequest, parseModelList } from "./modelCatalog";

describe("parseModelList", () => {
  it("keeps chat-capable OpenAI models only", () => {
    const ids = parseModelList("openai", {
      data: [
        { id: "gpt-5.4" },
        { id: "text-embedding-3-small" },
        { id: "whisper-1" },
        { id: "o3" },
        { id: "gpt-5.4" }
      ]
    });
    expect(ids).toEqual(["gpt-5.4", "o3"]);
  });

  it("strips the models/ prefix and drops non-generative Gemini models", () => {
    const ids = parseModelList("gemini", {
      models: [
        { name: "models/gemini-3-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] }
      ]
    });
    expect(ids).toEqual(["gemini-3-flash"]);
  });

  it("reads Anthropic and OpenRouter data arrays", () => {
    expect(parseModelList("anthropic", { data: [{ id: "claude-b" }, { id: "claude-a" }] })).toEqual(
      ["claude-a", "claude-b"]
    );
    expect(parseModelList("openrouter", { data: [{ id: "x/y" }] })).toEqual(["x/y"]);
  });
});

describe("buildModelListRequest", () => {
  it("sends typed keys inline and stored keys through the keychain", () => {
    const inline = buildModelListRequest("anthropic", { apiKey: "k" });
    expect(inline.method).toBe("GET");
    expect(inline.headers).toContainEqual(["x-api-key", "k"]);

    const stored = buildModelListRequest("openai", { apiKey: "", storedKeyProfileId: "p1" });
    expect(stored.auth).toEqual({ profileId: "p1", scheme: "bearer" });
    expect(stored.headers).toEqual([]);
  });
});
