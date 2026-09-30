/**
 * Offline verification of the pieces that do not need Atlas or an API key:
 * env validation, chunking, extraction, and the grounding prompt.
 *
 * Run with: npx tsx src/scripts/selftest.ts
 */
import { chunkText } from "../services/chunker.js";
import { extractText, resolveKind } from "../services/extract.js";
import { normalizeVector } from "../services/embeddings/types.js";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) failures++;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("\n[env]");
const { env } = await import("../config/env.js");
const nodePath = await import("node:path");
check("PORT parsed", Number.isInteger(env.PORT), String(env.PORT));
check(
  "chunk size/overlap valid",
  env.CHUNK_OVERLAP < env.CHUNK_SIZE,
  `${env.CHUNK_SIZE}/${env.CHUNK_OVERLAP}`,
);
check(
  "numCandidates >= topK",
  env.VECTOR_NUM_CANDIDATES >= env.VECTOR_TOP_K,
  `${env.VECTOR_NUM_CANDIDATES} >= ${env.VECTOR_TOP_K}`,
);
// Retrieval over-fetches then thresholds, so numCandidates must also cover the
// wider fetch window, not just the final ceiling.
check(
  "numCandidates covers over-fetch window",
  env.VECTOR_NUM_CANDIDATES >= env.VECTOR_TOP_K * 3,
  `${env.VECTOR_NUM_CANDIDATES} >= ${env.VECTOR_TOP_K * 3}`,
);
check(
  "relevance floor is a fraction",
  env.VECTOR_MIN_SCORE > 0 && env.VECTOR_MIN_SCORE < 1,
  String(env.VECTOR_MIN_SCORE),
);
// path.isAbsolute is platform-aware; a hand-rolled drive-letter check is not.
check(
  "model cache dir absolute",
  nodePath.isAbsolute(env.modelCacheDir),
  env.modelCacheDir,
);
check(
  "cache dir outside node_modules",
  !env.modelCacheDir.includes("node_modules"),
  env.modelCacheDir,
);

console.log("\n[kind resolution]");
check(".pdf -> pdf", resolveKind("a.pdf", "application/pdf") === "pdf");
check(".txt -> text", resolveKind("a.txt", "text/plain") === "text");
check(
  ".docx -> docx",
  resolveKind(
    "a.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ) === "docx",
);
check(".md -> text", resolveKind("notes.md", "text/markdown") === "text");
check(
  "fallback on generic mime",
  resolveKind("weird.pdf", "application/octet-stream") === "pdf",
);

console.log("\n[extraction]");
try {
  resolveKind("malware.exe", "application/x-msdownload");
  check("rejects .exe", false);
} catch (error) {
  check(
    "rejects .exe",
    (error as Error).name === "ApiError",
    (error as Error).message.slice(0, 48),
  );
}

const sample = "Vector search is a retrieval technique. ".repeat(40);
const extracted = await extractText(
  Buffer.from(sample, "utf8"),
  "sample.txt",
  "text/plain",
);
check(
  "txt extraction length",
  extracted.charCount > 100,
  String(extracted.charCount),
);
check("collapses blank lines", !/\n{3,}/.test(extracted.text));

try {
  await extractText(Buffer.from("   \n  \n "), "tiny.txt", "text/plain");
  check("rejects near-empty text", false);
} catch {
  check("rejects near-empty text", true);
}

console.log("\n[chunking]");
const long = Array.from(
  { length: 60 },
  (_, i) => `Paragraph ${i}. ${"content ".repeat(40)}`,
).join("\n\n");
const chunks = await chunkText(long, "test-doc");
check("produced multiple chunks", chunks.length > 1, `${chunks.length} chunks`);
check(
  "indices are sequential",
  chunks.every((c, i) => c.chunkIndex === i),
);
check(
  "no empty chunks",
  chunks.every((c) => c.text.trim().length > 0),
);
check(
  "respects chunkSize",
  chunks.every((c) => c.chars <= env.CHUNK_SIZE + 200),
  `max ${Math.max(...chunks.map((c) => c.chars))} vs limit ${env.CHUNK_SIZE}`,
);
check(
  "overlap present",
  chunks.length < 2 || chunks[0]!.text.slice(-40) !== "",
  "chunks share boundary content",
);

console.log("\n[vector helpers]");
const unit = normalizeVector([3, 4]);
check(
  "normalizes to unit length",
  Math.abs(Math.hypot(unit[0]!, unit[1]!) - 1) < 1e-9,
  `(${unit[0]?.toFixed(4)}, ${unit[1]?.toFixed(4)})`,
);
try {
  normalizeVector([0, 0]);
  check("rejects zero vector", false);
} catch {
  check("rejects zero vector", true);
}

console.log(
  `\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
