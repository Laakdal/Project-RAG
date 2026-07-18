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
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe(MOCK_CONFIG.config.GEMINI_READ_MODEL);
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toMatch(/^Bearer .+/);
  });

  it("throws on a non-ok response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    const { geminiRead } = await import("./models.js");
    await expect(geminiRead(Buffer.from("x"), "application/pdf")).rejects.toThrow();
  });
});
