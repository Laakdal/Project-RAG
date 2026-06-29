// Shared RAG contract. Both providers (n8n, langgraph) satisfy these shapes so
// chat-routes.ts is provider-agnostic. Signatures are positional to match the
// existing n8n-client.ts exactly, so wiring the seam is a one-line import swap.

export type QuerySource = {
  filename: string;
  chunkIndex: number;
  text: string;
  // Present for library results — links the citation to the source Drive doc.
  webUrl?: string;
};

export type QueryResult = {
  answer: string;
  sources: QuerySource[];
  title?: string;
};

export type IngestResult = {
  status: string;
  chunkCount: number;
};

export type ChatTurn = { role: string; content: string };

export interface RagProvider {
  queryRag(
    conversationId: string,
    question: string,
    history: ChatTurn[],
    generateTitle: boolean,
  ): Promise<QueryResult>;

  ingestFile(
    conversationId: string,
    filename: string,
    file: Buffer,
    mimeType: string,
  ): Promise<IngestResult>;
}
