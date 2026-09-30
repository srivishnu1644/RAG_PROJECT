import {
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import { env as hfEnv } from "@huggingface/transformers";
import path from "node:path";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import {
  assertVectorShape,
  normalizeVector,
  type EmbeddingProvider,
} from "./types.js";

/**
 * Free, fully local embeddings via Transformers.js (ONNX Runtime).
 * No API key, no network after first run, no per-request cost.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local-minilm";
  readonly dimensions: number;

  private extractor: FeatureExtractionPipeline | null = null;
  private loading: Promise<FeatureExtractionPipeline> | null = null;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  /** Lazy, singleton, and concurrency-safe. */
  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (this.extractor) return this.extractor;

    // De-duplicate concurrent first requests: without this, N parallel
    // requests would each kick off a separate 90MB model load.
    this.loading ??= (async () => {
      logger.info(`Loading local embedding model "${env.EMBEDDING_MODEL}"…`);

      // Must be set before the first pipeline() call. The default cache lives
      // inside node_modules, so a clean install would re-download the model.
      hfEnv.cacheDir = env.modelCacheDir;
      logger.debug(`Model cache directory: ${path.resolve(env.modelCacheDir)}`);

      const extractor = await pipeline(
        "feature-extraction",
        env.EMBEDDING_MODEL,
      );

      this.extractor = extractor;
      this.loading = null;
      logger.info("Local embedding model ready.");
      return extractor;
    })();

    return this.loading;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const extractor = await this.getExtractor();
    const vectors: number[][] = [];

    // MiniLM has a 512-token context. We chunk at 1000 characters (~250 tokens),
    // so each input fits comfortably and no truncation warning is expected.
    for (const text of texts) {
      const output = await extractor(text, {
        // BOTH options are required. The library defaults are
        // pooling: 'none' (returns a 3-D [1, seqLen, 384] token tensor) and
        // normalize: false (unnormalized magnitudes). Omitting either one
        // silently degrades cosine search quality with no error raised.
        pooling: "mean",
        normalize: true,
      });

      const vector = output.tolist()[0] as number[] | undefined;
      if (!vector) {
        throw new Error("Embedding model returned an empty vector.");
      }

      vectors.push(
        assertVectorShape(
          normalizeVector(vector),
          this.dimensions,
          "LocalEmbeddingProvider",
        ),
      );
    }

    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text]);
    if (!vector) throw new Error("Failed to embed query.");
    return vector;
  }

  /** Warms the model so the first user request is not slowed by a cold start. */
  async warmUp(): Promise<void> {
    await this.getExtractor();
  }
}
