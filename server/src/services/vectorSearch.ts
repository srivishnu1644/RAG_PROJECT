import { Types } from "mongoose";
import { env } from "../config/env.js";
import { Chunk } from "../models/Chunk.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";
import { embeddings } from "./embeddings/index.js";
import {
  duplicateKey,
  lexicalCoverage,
  selectExcerpt,
  tokenize,
} from "./rerank.js";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  text: string;
  score: number;
  /** Score after hybrid reranking, in 0-1. Higher is a better citation. */
  rerankScore?: number;
  /**
   * The part of `text` that actually answers the question, trimmed to a
   * readable length. Equals `text` when the chunk is already short.
   */
  excerpt?: string;
}

interface VectorSearchDoc {
  _id: Types.ObjectId;
  documentId: Types.ObjectId;
  filename: string;
  chunkIndex: number;
  text: string;
  embeddingVector?: number[];
  score?: number;
}

/**
 * Cosine similarity between the query and a stored chunk vector.
 *
 * `searchScore` is NOT reliably available: on this Atlas cluster (and on
 * free/shared tiers) `$vectorSearch` returns no `searchScore` metadata at all,
 * with or without a following `$project`. `undefined` was silently coerced to
 * 0 by `Number(undefined ?? 0)`, so every citation rendered as "0%" and looked
 * like a retrieval failure rather than a display bug.
 *
 * Atlas orders `$vectorSearch` results by relevance already, so ranking was
 * never wrong — only the number the user saw. Computing it here restores the
 * figure. Both sides are L2-normalized by the embedding provider, so the dot
 * product is already the cosine similarity; the explicit norms are a guard
 * rather than an optimization.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Maps Atlas's raw failure modes onto an actionable message. Without this,
 * a missing index surfaces as a wall of driver text and the usual reaction is
 * to blame the query.
 */
function diagnose(error: unknown): ApiError {
  const message = error instanceof Error ? error.message : String(error);

  if (/index .* does not exist|IndexNotFound/i.test(message)) {
    return ApiError.vectorIndexUnavailable(
      `no index named "${env.VECTOR_INDEX_NAME}" exists on the "chunks" collection. ` +
        "Create it in Atlas under Search Indexes. It takes a few minutes to become queryable.",
    );
  }
  if (/not yet ready|indexes are being built/i.test(message)) {
    return ApiError.vectorIndexUnavailable(
      "the index is still building. Atlas indexes can take several minutes on first creation.",
    );
  }
  if (/numDimensions|dimension/i.test(message)) {
    return ApiError.vectorIndexUnavailable(
      `dimension mismatch. The index was likely built for a different EMBEDDING_MODEL. ` +
        "Recreate it with numDimensions equal to EMBEDDING_DIMENSIONS.",
    );
  }
  if (/must index the fields that you want to filter/i.test(message)) {
    return ApiError.vectorIndexUnavailable(
      'the index is missing a filter field. Add "userId" and "documentId" as filter-type fields.',
    );
  }
  if (/timeout|connection|not primary|server selection/i.test(message)) {
    return ApiError.vectorIndexUnavailable(
      "could not reach the Atlas cluster.",
    );
  }

  logger.error("Unexpected vector search failure", error);
  return new ApiError(
    500,
    "VECTOR_SEARCH_FAILED",
    "Vector search failed unexpectedly.",
  );
}

export interface SearchOptions {
  userId: string;
  /** Restricts the search to specific documents. Empty or omitted = all. */
  documentIds?: string[];
  /** Hard ceiling on returned passages. Defaults to env.VECTOR_TOP_K. */
  topK?: number;
  /**
   * Relevance floor for a passage to be returned. Defaults to
   * env.VECTOR_MIN_SCORE. Passages under it are dropped.
   */
  minScore?: number;
  /**
   * Maximum passages from any single document. Defaults to
   * env.RERANK_MAX_PER_DOC. This is what stops one verbose file from filling
   * the whole citation panel and crowding out the other documents.
   */
  maxPerDocument?: number;
}

export interface SearchOutcome {
  /** Passages that cleared the relevance floor, best first. */
  chunks: RetrievedChunk[];
  /** Best score seen before thresholding, or 0 when nothing was returned. */
  topScore: number;
  /**
   * True when the index returned candidates but every one of them fell below
   * the floor. The caller uses this to tell "your library has nothing on this
   * topic" apart from "this index is empty", which need different advice.
   */
  allBelowThreshold: boolean;
  /** Distinct documents represented in `chunks`. */
  documentCount: number;
  /** Candidates dropped as duplicate overlap between chunks. */
  duplicatesDropped: number;
}

/**
 * Retrieval step of the read path: embed the question, then run an Atlas
 * $vectorSearch aggregation to pull the closest chunks.
 *
 * Retrieval deliberately OVER-fetches and then filters, in three passes:
 *
 *   1. over-fetch, so the threshold has candidates to work with
 *   2. hybrid rerank, blending cosine similarity with literal term overlap
 *   3. trim to a per-document cap, so citations stay varied
 *
 * The result is an answer built from as much genuinely relevant text as exists
 * — not a fixed number of passages, and not the same document five times.
 */
export async function searchRelevantChunks(
  query: string,
  options: SearchOptions,
): Promise<SearchOutcome> {
  const ceiling = options.topK ?? env.VECTOR_TOP_K;
  const minScore = options.minScore ?? env.VECTOR_MIN_SCORE;
  const maxPerDocument = options.maxPerDocument ?? env.RERANK_MAX_PER_DOC;

  // Over-fetch: the threshold can only ever remove candidates, so the fetch
  // has to be wide enough that a good set can still survive it. Atlas caps
  // `limit` at 10000, so this stays comfortably inside that.
  const fetchLimit = Math.min(Math.max(ceiling * 3, ceiling + 8), 200);
  const queryVector = await embeddings.embedQuery(query);

  // `filter` pre-filters the candidate set. Both fields MUST be declared as
  // {"type": "filter"} in the Atlas index definition, or Atlas rejects the query.
  // This is what enforces per-user isolation: a user can never retrieve
  // another user's chunks, regardless of what they ask.
  const filter: Record<string, unknown> = {
    userId: new Types.ObjectId(options.userId),
  };

  const documentIds = options.documentIds ?? [];
  if (documentIds.length > 0) {
    filter["documentId"] = {
      $in: documentIds.map((id) => new Types.ObjectId(id)),
    };
  }

  logger.debug(
    `Vector search: ceiling=${ceiling} fetch=${fetchLimit} ` +
      `minScore=${minScore} maxPerDoc=${maxPerDocument} ` +
      `numCandidates=${env.VECTOR_NUM_CANDIDATES} ` +
      `dim=${queryVector.length} scoped=${documentIds.length || "all"}`,
  );

  try {
    const results = await Chunk.aggregate<VectorSearchDoc>([
      {
        $vectorSearch: {
          index: env.VECTOR_INDEX_NAME,
          path: env.VECTOR_PATH,
          queryVector,
          // numCandidates is the recall/latency dial: larger searches more of
          // the candidate space before keeping the top `limit`.
          numCandidates: Math.max(env.VECTOR_NUM_CANDIDATES, fetchLimit),
          limit: fetchLimit,
          filter,
        },
      },
      {
        $project: {
          documentId: 1,
          filename: 1,
          chunkIndex: 1,
          text: 1,
          // Needed to derive the score locally. Requested alongside a
          // best-effort $meta so this keeps working unchanged on clusters
          // that DO return searchScore.
          embeddingVector: 1,
          score: { $meta: "searchScore" },
        },
      },
    ]);

    const scored: RetrievedChunk[] = results.map((doc) => ({
      chunkId: String(doc._id),
      documentId: String(doc.documentId),
      filename: doc.filename,
      chunkIndex: doc.chunkIndex,
      text: doc.text,
      // Prefer the server's score when it exists; otherwise derive it.
      score:
        typeof doc.score === "number"
          ? doc.score
          : doc.embeddingVector
            ? cosineSimilarity(queryVector, doc.embeddingVector)
            : 0,
    }));

    const topScore = scored.length > 0 ? (scored[0]?.score ?? 0) : 0;

    /*
     * Pass 1 — hybrid rerank.
     *
     * Cosine alone ranks paraphrases well but happily returns five passages
     * from one document. Blending in literal term overlap breaks those ties,
     * because a passage that actually names the thing asked about scores
     * higher than one that merely sits near it semantically.
     */
    const queryTokens = new Set(tokenize(query));
    const hybrid = scored
      .map((chunk) => {
        const lexical = lexicalCoverage(queryTokens, chunk.text);
        const blended =
          chunk.score * (1 - env.RERANK_LEXICAL_WEIGHT) +
          lexical * env.RERANK_LEXICAL_WEIGHT;

        return { ...chunk, rerankScore: blended, lexical };
      })
      // Sort on the blended score, with cosine as a stable tiebreak so two
      // passages that overlap the query equally keep their vector ordering.
      .sort((a, b) => b.rerankScore! - a.rerankScore! || b.score - a.score);

    const deduped: typeof hybrid = [];
    const seen = new Set<string>();
    let duplicatesDropped = 0;

    for (const chunk of hybrid) {
      const key = duplicateKey(chunk.text);
      if (seen.has(key)) {
        duplicatesDropped++;
        continue;
      }
      seen.add(key);
      deduped.push(chunk);
    }

    /*
     * Pass 2 — relevance floor. Applied to the reranked score, not the raw
     * cosine, so a passage is judged on the combined signal the citation
     * panel will actually show.
     */
    const relevant = deduped.filter((chunk) => chunk.rerankScore! >= minScore);

    /*
     * Pass 3 — per-document cap. Takes the best N from each file before
     * filling the remaining budget in global rank order, so variety is
     * preserved without demoting a strong match behind a weak one.
     */
    const perDocument = new Map<string, number>();
    const trimmed: typeof relevant = [];

    for (const chunk of relevant) {
      if (trimmed.length >= ceiling) break;

      const seenForDoc = perDocument.get(chunk.filename) ?? 0;
      if (seenForDoc >= maxPerDocument) continue;

      perDocument.set(chunk.filename, seenForDoc + 1);
      trimmed.push(chunk);
    }

    // Excerpt each passage down to the part that actually answers the
    // question. The model still receives the FULL chunk; only the citation
    // the user reads is trimmed.
    for (const chunk of trimmed) {
      chunk.excerpt = selectExcerpt(
        query,
        chunk.text,
        env.CITATION_EXCERPT_CHARS,
      );
    }

    logger.info(
      `Retrieved ${trimmed.length}/${scored.length} passage(s) across ` +
        `${perDocument.size} document(s) for query "${query.slice(0, 60)}" ` +
        `(top cosine ${topScore.toFixed(3)}, top hybrid ` +
        `${(trimmed[0]?.rerankScore ?? 0).toFixed(3)}, floor ${minScore}, ` +
        `dropped ${duplicatesDropped} duplicate(s))`,
    );

    return {
      chunks: trimmed,
      topScore,
      allBelowThreshold: scored.length > 0 && relevant.length === 0,
      documentCount: perDocument.size,
      duplicatesDropped,
    };
  } catch (error) {
    throw diagnose(error);
  }
}
