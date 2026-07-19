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

// A single pipeline step reported to the client during a streaming query, so
// the UI can show real progress ("searching your documents", "reading Drive",
// "writing the answer") instead of a generic spinner. `key` is the stable graph
// node id; `label` is the human, display-ready text.
export type QueryPhase = {
  key: string;
  label: string;
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

  // Optional streaming variant: runs the same query but reports each pipeline
  // step through `onPhase` as it starts, then resolves with the final answer.
  // Only the in-process (langgraph) provider implements this; the n8n provider
  // has no in-process graph to observe, so callers fall back to `queryRag`.
  queryRagStream?(
    conversationId: string,
    question: string,
    history: ChatTurn[],
    generateTitle: boolean,
    onPhase: (phase: QueryPhase) => void,
    onToken?: (text: string) => void,
  ): Promise<QueryResult>;

  ingestFile(
    conversationId: string,
    filename: string,
    file: Buffer,
    mimeType: string,
  ): Promise<IngestResult>;
}
