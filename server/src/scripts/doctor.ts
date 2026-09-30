/**
 * Verifies the exact runtime shapes this project depends on.
 * Run with: npm run doctor
 *
 * This exists because two dependencies changed shape in ways that fail
 * silently or confusingly if you assume the old API:
 *   - pdf-parse v2: the old `pdfParse(buffer)` callable default is gone.
 *   - @huggingface/transformers: defaults to pooling 'none' / normalize false.
 */
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

const line = (label: string, value: string): void => {
  console.log(`  ${label.padEnd(22)} ${value}`);
};

async function checkPdfParse(): Promise<void> {
  console.log("\n[pdf-parse v2]");
  const mod = (await import("pdf-parse")) as unknown as Record<string, unknown>;
  const hasV2Class = typeof mod["PDFParse"] === "function";
  line("PDFParse class", hasV2Class ? "present" : "MISSING (v2 API required)");
  line(
    "legacy callable default",
    typeof mod["default"] === "function"
      ? "present"
      : "absent (expected on v2)",
  );
}

async function checkEmbeddings(model: string): Promise<void> {
  console.log(`\n[@huggingface/transformers] model=${model}`);
  env.cacheDir = process.env["MODEL_CACHE_DIR"] ?? "../.models-cache";

  const extractor = (await pipeline(
    "feature-extraction",
    model,
  )) as FeatureExtractionPipeline;
  const out = await extractor("vector search pipeline health check", {
    // BOTH are required. Without them you get a [1, seqLen, 384] tensor and
    // unnormalized vectors, which quietly degrades cosine search quality.
    pooling: "mean",
    normalize: true,
  });

  const vector = out.tolist()[0] as number[];
  const magnitude = Math.sqrt(
    vector.reduce<number>((sum, v) => sum + v * v, 0),
  );

  line("output dims", String(vector.length));
  line("magnitude", magnitude.toFixed(4));
  line(
    "L2 normalized",
    Math.abs(magnitude - 1) < 0.01 ? "yes" : "NO (normalize:true missing)",
  );
}

async function main(): Promise<void> {
  console.log("Toolchain doctor");
  await checkPdfParse();
  try {
    await checkEmbeddings(
      process.env["EMBEDDING_MODEL"] ?? "Xenova/all-MiniLM-L6-v2",
    );
  } catch (error) {
    console.error("  embedding check FAILED:", (error as Error).message);
    process.exitCode = 1;
  }
  console.log("");
}

await main();
