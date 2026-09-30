import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export interface TextChunk {
  chunkIndex: number;
  text: string;
  chars: number;
}

/**
 * Splits extracted text into overlapping chunks.
 *
 * Per the architecture spec: 1000 characters with 200 characters of overlap.
 * The overlap preserves context continuity across chunk boundaries, so a fact
 * that straddles a split is still retrievable.
 *
 * Note: chunkSize is measured in CHARACTERS, not tokens. At 1000 characters
 * (~250 English tokens) we sit well inside MiniLM's 512-token window, so
 * nothing is silently truncated at embedding time.
 */
export async function chunkText(
  text: string,
  documentId: string,
): Promise<TextChunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: env.CHUNK_SIZE,
    chunkOverlap: env.CHUNK_OVERLAP,
  });

  const documents = await splitter.createDocuments([text], [{ documentId }]);

  const chunks: TextChunk[] = documents
    .map((document, chunkIndex) => {
      const chunkText = document.pageContent.trim();
      return {
        chunkIndex,
        text: chunkText,
        chars: chunkText.length,
      };
    })
    // The splitter can emit whitespace-only fragments at the edges. Embedding
    // those adds cost and noise to the vector index, so drop them.
    .filter((chunk) => chunk.chars > 0);

  if (chunks.length === 0) {
    throw new Error("Chunking produced no usable chunks.");
  }

  logger.debug(
    `Chunked into ${chunks.length} chunks ` +
      `(avg ${Math.round(chunks.reduce((sum, c) => sum + c.chars, 0) / chunks.length)} chars)`,
  );

  return chunks;
}
