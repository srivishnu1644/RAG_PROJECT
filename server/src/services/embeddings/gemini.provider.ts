import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { ApiError } from "../../utils/ApiError.js";
import {
  assertVectorShape,
  normalizeVector,
  type EmbeddingProvider,
} from "./types.js";

/**
 * Gemini embeddings, requested at 384 dimensions to match the local MiniLM
 * space. Both are L2-normalized on the way out, so switching providers with a
 * one-line env change does NOT require re-indexing existing documents.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini";
  readonly dimensions: number;

  private client: GoogleGenAI | null = null;

  constructor() {
    this.dimensions = env.EMBEDDING_DIMENSIONS;
  }

  private getClient(): GoogleGenAI {
    if (!env.GEMINI_API_KEY) {
      throw ApiError.badRequest(
        "EMBEDDING_PROVIDER=gemini requires GEMINI_API_KEY.",
      );
    }
    this.client ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    return this.client;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const client = this.getClient();
    const vectors: number[][] = [];

    // One call per text rather than a batch: the batch helper
    // (embedContent with an array) is inconsistent across SDK versions, and
    // this keeps error attribution unambiguous.
    for (const text of texts) {
      try {
        const response = await client.models.embedContent({
          model: env.EMBEDDING_MODEL,
          contents: text,
          config: {
            // Asymmetric task hints materially improve retrieval quality:
            // documents and queries are embedded differently on purpose.
            taskType: "RETRIEVAL_DOCUMENT",
            outputDimensionality: this.dimensions,
          },
        });

        const values = response.embeddings?.[0]?.values;
        if (!values || values.length === 0) {
          throw new Error("Gemini returned an empty embedding.");
        }

        vectors.push(
          assertVectorShape(
            normalizeVector([...values]),
            this.dimensions,
            "GeminiEmbeddingProvider",
          ),
        );
      } catch (error) {
        logger.error("Gemini embedding call failed", error);
        throw ApiError.llmUnavailable(
          error instanceof Error ? error.message : "unknown error",
        );
      }
    }

    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const client = this.getClient();

    try {
      const response = await client.models.embedContent({
        model: env.EMBEDDING_MODEL,
        contents: text,
        config: {
          // Paired task type: a query must be embedded with RETRIEVAL_QUERY
          // to sit in the same space as the RETRIEVAL_DOCUMENT chunks.
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: this.dimensions,
        },
      });

      const values = response.embeddings?.[0]?.values;
      if (!values || values.length === 0) {
        throw new Error("Gemini returned an empty embedding.");
      }

      return assertVectorShape(
        normalizeVector([...values]),
        this.dimensions,
        "GeminiEmbeddingProvider.embedQuery",
      );
    } catch (error) {
      logger.error("Gemini query embedding failed", error);
      throw ApiError.llmUnavailable(
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
}
