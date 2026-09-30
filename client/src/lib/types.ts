export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface DocumentSummary {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  charCount: number;
  chunkCount: number;
  status: "ready" | "failed";
  createdAt: string;
}

export interface LibraryStats {
  documentCount: number;
  chunkCount: number;
  embeddingProvider: string;
  embeddingDimensions: number;
  chunkSize: number;
  chunkOverlap: number;
}

export interface RetrievedSource {
  chunkId: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  /** Full retrieved chunk. The model is given this. */
  text: string;
  /**
   * The short, question-relevant slice of `text` that the citation panel
   * displays. Undefined means `text` was already short enough to show whole.
   */
  excerpt?: string;
  /** Raw cosine similarity against the query, 0-1. */
  score: number;
  /** Score after hybrid reranking, 0-1. This is the ranked value. */
  rerankScore?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: RetrievedSource[];
  /** True while tokens are still arriving for this message. */
  streaming?: boolean;
  error?: boolean;
}

export interface HealthResponse {
  status: string;
  uptimeSeconds: number;
  embeddings: { provider: string; dimensions: number };
  chat: { provider: string; available: boolean };
  chunking: { size: number; overlap: number };
}
