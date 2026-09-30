import { config as loadEnv } from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve .env relative to THIS FILE, not process.cwd().
 *
 * `dotenv/config` reads from the current working directory, which means the
 * server breaks when launched from the repo root ("node backend/dist/server.js")
 * or from a service manager with a different cwd. Anchoring to the module
 * location makes the app start identically from anywhere.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// src/config -> backend
const backendRoot = path.resolve(moduleDir, "..", "..");

loadEnv({ path: path.join(backendRoot, ".env") });

/** Coerces "5" -> 5, "true" -> true, then validates ranges. */
const numeric = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

/** Same, but keeps the decimal: cosine scores are never integers. */
const decimal = (min: number, max: number) =>
  z.coerce.number().min(min).max(max);

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: numeric(1, 65535).default(5000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().default("rag_app"),

  JWT_SECRET: z.string().min(8, "JWT_SECRET must be at least 8 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  EMBEDDING_PROVIDER: z.enum(["local", "gemini"]).default("local"),
  EMBEDDING_DIMENSIONS: numeric(1, 3072).default(384),
  EMBEDDING_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  MODEL_CACHE_DIR: z.string().default("../.models-cache"),

  GEMINI_API_KEY: z.string().optional(),
  CHAT_MODEL: z.string().default("gemini-2.5-flash"),

  CHUNK_SIZE: numeric(100, 8000).default(1000),
  CHUNK_OVERLAP: numeric(0, 4000).default(200),

  VECTOR_INDEX_NAME: z.string().default("vector_index"),
  VECTOR_PATH: z.string().default("embeddingVector"),
  // Upper bound on how many passages a single answer may cite. This is a
  // ceiling for readability, not a target: retrieval returns however many
  // passages actually clear VECTOR_MIN_SCORE, up to this many.
  VECTOR_TOP_K: numeric(1, 50).default(12),
  // Relevance floor. Passages scoring below this are treated as noise and
  // dropped, so an unrelated question yields no context at all rather than
  // three weak passages the model will try and confabulate from.
  //
  // 0.2 rather than 0.25: on short chunks a genuinely on-topic question
  // often lands around 0.21-0.23, and a floor that high refuses real
  // questions. Unrelated ones still score under 0.1, so the floor only needs
  // to sit above that band, not high up the range.
  VECTOR_MIN_SCORE: decimal(0, 1).default(0.2),
  // How many candidates to pull from the index before thresholding. Larger
  // than VECTOR_TOP_K on purpose: filtering happens after scoring, so the
  // fetch has to be wide enough that filtering can still leave a full set.
  VECTOR_NUM_CANDIDATES: numeric(1, 10000).default(150),

  // ── Reranking & citations ───────────────────────────────────────────
  // Weight given to literal term overlap when blending with cosine
  // similarity. 0 = pure vector search, 1 = pure keyword match. Around 0.35
  // is the sweet spot: enough to break up "five passages from one file",
  // not so much that a question phrased differently scores near zero.
  RERANK_LEXICAL_WEIGHT: decimal(0, 1).default(0.35),
  // Max passages kept from any single document. Without this, one verbose
  // file fills the entire citation panel and hides the other documents.
  RERANK_MAX_PER_DOC: numeric(1, 10).default(2),
  // Character budget for a displayed citation. Chunks are ~1000 characters of
  // raw document; showing them whole buries the answer in evidence.
  CITATION_EXCERPT_CHARS: numeric(80, 4000).default(220),

  MAX_FILE_SIZE_MB: numeric(1, 200).default(25),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  console.error(`\nInvalid environment configuration:\n${details}\n`);
  console.error("Copy backend/.env.example to backend/.env and fill it in.\n");
  process.exit(1);
}

const raw = parsed.data;

// Fail fast on a config that is internally inconsistent, rather than
// letting it surface as a confusing Atlas error minutes later.
if (raw.CHUNK_OVERLAP >= raw.CHUNK_SIZE) {
  console.error(
    `\nCHUNK_OVERLAP (${raw.CHUNK_OVERLAP}) must be smaller than CHUNK_SIZE (${raw.CHUNK_SIZE}).\n`,
  );
  process.exit(1);
}

if (raw.VECTOR_NUM_CANDIDATES < raw.VECTOR_TOP_K) {
  console.error(
    `\nVECTOR_NUM_CANDIDATES (${raw.VECTOR_NUM_CANDIDATES}) must be >= VECTOR_TOP_K (${raw.VECTOR_TOP_K}).\n`,
  );
  process.exit(1);
}

if (raw.EMBEDDING_PROVIDER === "gemini" && !raw.GEMINI_API_KEY) {
  console.error(
    "\nEMBEDDING_PROVIDER=gemini requires GEMINI_API_KEY to be set.\n",
  );
  process.exit(1);
}

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === "production",
  backendRoot,
  // Relative MODEL_CACHE_DIR values resolve against the backend folder, not
  // the cwd, so "../.models-cache" lands in the same place no matter how the
  // process was launched.
  modelCacheDir: path.resolve(backendRoot, raw.MODEL_CACHE_DIR),
  corsOrigins: raw.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const;

export type Env = typeof env;
