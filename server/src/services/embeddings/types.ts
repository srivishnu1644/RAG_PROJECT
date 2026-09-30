/**
 * Provider-agnostic embedding interface.
 *
 * The whole point: swapping MiniLM (free, local) for Gemini or OpenAI is a
 * one-line env change, with no call-site edits. Every implementation MUST
 * return L2-normalized vectors of exactly `dimensions` length, because Atlas
 * stores them as-is and the similarity function assumes a consistent space.
 */
export interface EmbeddingProvider {
  /** Human-readable id, surfaced on /api/health. */
  readonly name: string;
  /** Vector width. Must equal the Atlas index numDimensions. */
  readonly dimensions: number;

  /** Embeds a batch. Order of the result matches the order of the input. */
  embedDocuments(texts: string[]): Promise<number[][]>;

  /** Single-text convenience wrapper. */
  embedQuery(text: string): Promise<number[]>;
}

/** L2-normalizes a vector in place-safe fashion. */
export function normalizeVector(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;

  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) {
    throw new Error("Cannot normalize a zero-magnitude vector.");
  }

  return vector.map((value) => value / magnitude);
}

/** Fails loudly if a provider returns the wrong shape. */
export function assertVectorShape(
  vector: number[],
  expected: number,
  context: string,
): number[] {
  if (!Array.isArray(vector)) {
    throw new Error(`${context}: provider did not return an array.`);
  }
  if (vector.length !== expected) {
    throw new Error(
      `${context}: expected ${expected} dimensions but received ${vector.length}. ` +
        "If you changed EMBEDDING_MODEL or EMBEDDING_DIMENSIONS, you must also " +
        "recreate the Atlas vector search index.",
    );
  }
  return vector;
}
