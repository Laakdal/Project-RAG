import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Runnable } from "@langchain/core/runnables";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { AIMessageChunk } from "@langchain/core/messages";
import { config } from "../../src/config.js";

export function requireLanggraphEnv(): void {
  const missing = [
    !config.OPENAI_API_KEY && "OPENAI_API_KEY",
    !config.OPENROUTER_API_KEY && "OPENROUTER_API_KEY",
    !config.QDRANT_URL && "QDRANT_URL",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`RAG_PROVIDER=langgraph requires: ${missing.join(", ")}`);
  }
}

export function makeEmbeddings(): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    model: config.EMBED_MODEL,
    apiKey: config.OPENAI_API_KEY,
  });
}

export function makeChatModel(
  opts: { webSearch?: boolean } = {}
): Runnable<BaseLanguageModelInput, AIMessageChunk> {
  const model = new ChatOpenAI({
    model: config.GENERATE_MODEL,
    apiKey: config.OPENAI_API_KEY,
    useResponsesApi: true,
  });
  return opts.webSearch
    ? model.bindTools([{ type: "web_search_preview" }])
    : model;
}

// Answer generator: glm-4.6 through OpenRouter's OpenAI-compatible endpoint, to
// match the live n8n "Generate Answer" node. Kept separate from makeChatModel
// (which stays on OpenAI for the web-search Responses API) so only the answer
// step swaps models.
export function makeAnswerModel(): Runnable<BaseLanguageModelInput, AIMessageChunk> {
  return new ChatOpenAI({
    model: config.ANSWER_MODEL,
    apiKey: config.OPENROUTER_API_KEY,
    configuration: { baseURL: config.OPENROUTER_BASE_URL },
    // Match the live n8n node: temperature 0 so glm-4.6 reliably follows the
    // strict formatting rules (Mermaid fences, no headings).
    temperature: 0,
  });
}

// Read a document by handing the raw bytes to Gemini (vision/multimodal) over
// OpenRouter's OpenAI-compatible chat completions endpoint. Returns plain text.
export async function geminiRead(file: Buffer, mimeType: string): Promise<string> {
  const dataUrl = `data:${mimeType};base64,${file.toString("base64")}`;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.GEMINI_READ_MODEL,
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
