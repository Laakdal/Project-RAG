import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const MOCK_CONFIG = {
  config: {
    GENERATE_MODEL: "gpt-test",
    OPENAI_API_KEY: "test-key",
    OPENROUTER_API_KEY: "or-key",
    QDRANT_URL: "http://qdrant",
    EMBED_MODEL: "embed-test",
    GEMINI_READ_MODEL: "gemini-test",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  },
};

// The model factories now read managed keys through the settings service
// (DB override -> env fallback). Mock it to return the same test values.
const SETTING_VALUES: Record<string, string> = {
  GENERATE_MODEL: "gpt-test",
  OPENAI_API_KEY: "test-key",
  OPENROUTER_API_KEY: "or-key",
  EMBED_MODEL: "embed-test",
  GEMINI_READ_MODEL: "gemini-test",
  ANSWER_MODEL: "answer-test",
  INTENT_MODEL: "intent-test",
};
const MOCK_SETTINGS = { getSetting: (k: string) => SETTING_VALUES[k] };

describe("supportsTemperature", () => {
  it("allows temperature on ordinary chat models", async () => {
    const { supportsTemperature } = await import("./models.js");
    for (const m of [
      "gpt-4o-mini",
      "z-ai/glm-4.6",
      "models/gemini-2.5-pro",
      "anthropic/claude-sonnet-4-6",
      undefined,
    ]) {
      expect(supportsTemperature(m)).toBe(true);
    }
  });

  it("rejects temperature on reasoning models, which 400 on any non-default value", async () => {
    const { supportsTemperature } = await import("./models.js");
    for (const m of ["gpt-5", "gpt-5-mini", "openai/gpt-5", "o1", "o3-mini", "o4-mini"]) {
      expect(supportsTemperature(m)).toBe(false);
    }
  });
});

describe("makeChatModel", () => {
  it("constructs ChatOpenAI with the config values and returns an invokable", async () => {
    const bindToolsMock = vi.fn().mockReturnValue({ invoke: vi.fn() });
    // Must use a regular function (not arrow) so `new` works
    const ChatOpenAIMock = vi.fn(function (this: Record<string, unknown>) {
      this.bindTools = bindToolsMock;
      this.invoke = vi.fn();
    });
    vi.doMock("@langchain/openai", () => ({ ChatOpenAI: ChatOpenAIMock, OpenAIEmbeddings: vi.fn() }));
    vi.doMock("../../src/config.js", () => MOCK_CONFIG);
    vi.doMock("../../src/settings/service.js", () => MOCK_SETTINGS);
    vi.doMock("../../src/settings/connections.js", () => ({ resolveRole: () => undefined }));

    const { makeChatModel } = await import("./models.js");
    const result = makeChatModel();

    expect(ChatOpenAIMock).toHaveBeenCalledWith({
      model: "gpt-test",
      apiKey: "test-key",
      configuration: { baseURL: "https://api.openai.com/v1" },
      // Rewrite and grade must be deterministic — they run upstream of the
      // answer model, so sampling here changes the retrieved context.
      temperature: 0,
      useResponsesApi: false,
    });
    expect(typeof result.invoke).toBe("function");
    expect(bindToolsMock).not.toHaveBeenCalled();
  });

  it("calls bindTools([{type:'web_search_preview'}]) when webSearch=true", async () => {
    const invokeMock = vi.fn();
    const bindToolsMock = vi.fn().mockReturnValue({ invoke: invokeMock });
    const ChatOpenAIMock = vi.fn(function (this: Record<string, unknown>) {
      this.bindTools = bindToolsMock;
      this.invoke = vi.fn();
    });
    vi.doMock("@langchain/openai", () => ({ ChatOpenAI: ChatOpenAIMock, OpenAIEmbeddings: vi.fn() }));
    vi.doMock("../../src/config.js", () => MOCK_CONFIG);
    vi.doMock("../../src/settings/service.js", () => MOCK_SETTINGS);
    vi.doMock("../../src/settings/connections.js", () => ({ resolveRole: () => undefined }));

    const { makeChatModel } = await import("./models.js");
    const result = makeChatModel({ webSearch: true });

    expect(bindToolsMock).toHaveBeenCalledWith([{ type: "web_search_preview" }]);
    expect(typeof result.invoke).toBe("function");
  });
});

describe("base URL normalisation", () => {
  it("does not double the slash when the connection's base URL ends with one", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "text" } }] }),
    });
    vi.doMock("../../src/config.js", () => MOCK_CONFIG);
    vi.doMock("../../src/settings/service.js", () => MOCK_SETTINGS);
    vi.doMock("../../src/settings/connections.js", () => ({
      resolveRole: () => ({
        model: "gemini-3.1-pro-preview",
        apiKey: "k",
        // Exactly how Google publishes its OpenAI-compatible endpoint.
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      }),
    }));
    const { geminiRead } = await import("./models.js");
    await geminiRead(Buffer.from("x"), "image/png");
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(String(url)).not.toContain("//chat");
  });
});

describe("geminiRead", () => {
  it("posts the file to OpenRouter and returns the extracted text", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "extracted text" } }] }),
    });
    vi.doMock("../../src/config.js", () => MOCK_CONFIG);
    vi.doMock("../../src/settings/service.js", () => MOCK_SETTINGS);
    vi.doMock("../../src/settings/connections.js", () => ({ resolveRole: () => undefined }));
    const { geminiRead } = await import("./models.js");
    const text = await geminiRead(Buffer.from("%PDF-1.4"), "application/pdf");
    expect(text).toBe("extracted text");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("openrouter");
    const body = JSON.parse(init.body as string) as {
      model: string;
      temperature: number;
      max_tokens: number;
    };
    expect(body.model).toBe(MOCK_CONFIG.config.GEMINI_READ_MODEL);
    // Verbatim transcription, and a cap high enough not to truncate long docs.
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(16384);
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toMatch(/^Bearer .+/);
  });

  it("throws on a non-ok response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    const { geminiRead } = await import("./models.js");
    await expect(geminiRead(Buffer.from("x"), "application/pdf")).rejects.toThrow();
  });
});
