import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 150,
});

export async function chunkText(text: string): Promise<string[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return splitter.splitText(trimmed);
}
