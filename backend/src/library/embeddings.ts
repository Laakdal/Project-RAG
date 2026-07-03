import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../config.js";

export function makeEmbeddings(): OpenAIEmbeddings {
  if (!config.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for library embeddings");
  }
  return new OpenAIEmbeddings({
    apiKey: config.OPENAI_API_KEY,
    model: config.EMBED_MODEL,
  });
}
