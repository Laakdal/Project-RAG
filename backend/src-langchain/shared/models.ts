import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Runnable } from "@langchain/core/runnables";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { AIMessageChunk } from "@langchain/core/messages";
import { config } from "../../src/config.js";
import { getSetting } from "../../src/settings/service.js";
import { resolveRole, type Role } from "../../src/settings/connections.js";

const OPENAI_BASE = "https://api.openai.com/v1";

// Resolve a role's {model, apiKey, baseURL} from its bound API connection,
// falling back to the env settings so nothing breaks if a role is unbound.
function forRole(
  role: Role,
  fallback: { model: string | undefined; apiKey: string | undefined; baseURL: string },
): { model: string | undefined; apiKey: string | undefined; baseURL: string } {
  const c = resolveRole(role);
  if (!c) return fallback;
  return { model: c.model, apiKey: c.apiKey, baseURL: c.baseUrl || fallback.baseURL };
}

// Reasoning models reject any temperature other than their default of 1 —
// OpenAI returns a hard 400 ("Unsupported value: 'temperature' does not support
// 0 with this model"), not a warning, so a pinned 0 breaks every call. Detection
// is by model name because api_connections has no per-model capability flag; a
// future reasoning model under a different naming scheme will need adding here.
const REASONING_MODEL = /(?:^|\/)(?:gpt-5|o1|o3|o4)(?:[-.]|$)/;

export function supportsTemperature(model: string | undefined): boolean {
  if (!model) return true;
  return !REASONING_MODEL.test(model.toLowerCase());
}

// Spread into a ChatOpenAI constructor: pins the temperature where the model
// accepts one, and omits the field entirely where it does not.
function temperatureOption(model: string | undefined, value: number): { temperature?: number } {
  return supportsTemperature(model) ? { temperature: value } : {};
}

export function requireLanggraphEnv(): void {
  const missing = [
    !forRole("answer", { model: undefined, apiKey: getSetting("OPENROUTER_API_KEY"), baseURL: "" }).apiKey && "an 'answer' API connection",
    !forRole("embedding", { model: undefined, apiKey: getSetting("OPENAI_API_KEY"), baseURL: "" }).apiKey && "an 'embedding' API connection",
    !config.QDRANT_URL && "QDRANT_URL",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`RAG_PROVIDER=langgraph requires: ${missing.join(", ")}`);
  }
}

export function makeEmbeddings(): OpenAIEmbeddings {
  const c = forRole("embedding", {
    model: getSetting("EMBED_MODEL"),
    apiKey: getSetting("OPENAI_API_KEY"),
    baseURL: OPENAI_BASE,
  });
  return new OpenAIEmbeddings({
    model: c.model,
    apiKey: c.apiKey,
    configuration: { baseURL: c.baseURL },
  });
}

export function makeChatModel(
  opts: { webSearch?: boolean } = {}
): Runnable<BaseLanguageModelInput, AIMessageChunk> {
  const c = forRole("utility", {
    model: getSetting("GENERATE_MODEL"),
    apiKey: getSetting("OPENAI_API_KEY"),
    baseURL: OPENAI_BASE,
  });
  const model = new ChatOpenAI({
    model: c.model,
    apiKey: c.apiKey,
    configuration: { baseURL: c.baseURL },
    // Rewrite and grade are near-binary judgements, and they run UPSTREAM of the
    // answer model: a chunk graded relevant on one run and dropped on the next
    // changes the context, so the answer changes even though the generator is
    // pinned. Leaving this unset inherits the provider default (~1.0) and makes
    // runs unreproducible.
    ...temperatureOption(c.model, 0),
    // Web search uses OpenAI's Responses API; only enable it for that path so a
    // non-OpenAI utility connection still works for plain rewrite/grade calls.
    useResponsesApi: Boolean(opts.webSearch),
  });
  return opts.webSearch
    ? model.bindTools([{ type: "web_search_preview" }])
    : model;
}

// Answer generator (glm-4.6 via OpenRouter by default). Temperature 0 so it
// reliably follows the strict formatting rules (Mermaid fences, no headings) —
// unless the bound model is a reasoning model, which rejects it outright.
export function makeAnswerModel(): Runnable<BaseLanguageModelInput, AIMessageChunk> {
  const c = forRole("answer", {
    model: getSetting("ANSWER_MODEL"),
    apiKey: getSetting("OPENROUTER_API_KEY"),
    baseURL: config.OPENROUTER_BASE_URL,
  });
  return new ChatOpenAI({
    model: c.model,
    apiKey: c.apiKey,
    configuration: { baseURL: c.baseURL },
    ...temperatureOption(c.model, 0),
    // Stream the underlying request so LangGraph's "messages" stream mode can
    // surface answer tokens as they arrive (the graph's token-by-token path).
    // `.invoke` still returns the fully aggregated message, so the non-streaming
    // runQuery path is unaffected.
    streaming: true,
  });
}

// Intent classifier (gemini-2.5-flash via OpenRouter by default), temperature 0.
export function makeIntentModel(): Runnable<BaseLanguageModelInput, AIMessageChunk> {
  const c = forRole("intent", {
    model: getSetting("INTENT_MODEL"),
    apiKey: getSetting("OPENROUTER_API_KEY"),
    baseURL: config.OPENROUTER_BASE_URL,
  });
  return new ChatOpenAI({
    model: c.model,
    apiKey: c.apiKey,
    configuration: { baseURL: c.baseURL },
    ...temperatureOption(c.model, 0),
  });
}

// Read a document by handing the raw bytes to a vision/multimodal model over an
// OpenAI-compatible chat completions endpoint (the "reader" connection).
export async function geminiRead(file: Buffer, mimeType: string): Promise<string> {
  const c = forRole("reader", {
    model: getSetting("GEMINI_READ_MODEL"),
    apiKey: getSetting("OPENROUTER_API_KEY"),
    baseURL: config.OPENROUTER_BASE_URL,
  });
  const dataUrl = `data:${mimeType};base64,${file.toString("base64")}`;
  const res = await fetch(`${c.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.apiKey}`,
    },
    body: JSON.stringify({
      model: c.model,
      // Transcription, not generation: temperature 0 keeps the model copying the
      // page verbatim instead of paraphrasing it. Without an explicit max_tokens
      // the provider's default output cap truncates long documents mid-way.
      // Both match what the n8n Read PDF / Read Image nodes send.
      temperature: 0,
      max_tokens: 16384,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all readable text from this document. Return only the text." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`gemini read failed: ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}
