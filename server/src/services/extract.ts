import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";

export type SupportedKind = "pdf" | "text" | "docx";

export interface ExtractedDocument {
  text: string;
  kind: SupportedKind;
  charCount: number;
}

/**
 * A PDF below this many non-whitespace characters almost certainly has no
 * text layer (i.e. it is a scan). We reject it explicitly rather than
 * ingesting a document with zero chunks, which would look like a silent bug.
 */
const MIN_USABLE_TEXT_CHARS = 50;

const EXTENSION_KIND: Record<string, SupportedKind> = {
  ".pdf": "pdf",
  ".txt": "text",
  ".md": "text",
  ".docx": "docx",
};

export function resolveKind(filename: string, mimeType: string): SupportedKind {
  const dot = filename.lastIndexOf(".");
  const extension = dot >= 0 ? filename.slice(dot).toLowerCase() : "";

  const byExtension = EXTENSION_KIND[extension];
  if (byExtension) return byExtension;

  // Fall back to MIME when the extension is missing or unusual, because
  // browsers often send a generic type like application/octet-stream.
  if (mimeType === "application/pdf") return "pdf";
  if (
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    mimeType.startsWith("text/")
  ) {
    return "text";
  }
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }

  throw ApiError.unsupportedMedia(
    `"${filename}" is not a supported file type. Upload a PDF, TXT, MD, or DOCX file.`,
  );
}

async function extractPdf(buffer: Buffer, filename: string): Promise<string> {
  // pdf-parse v2 is a rewrite: the old `pdfParse(buffer)` callable default is
  // gone, and destroy() is REQUIRED to release the underlying pdf.js resources.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    return result.text ?? "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/password/i.test(message)) {
      throw ApiError.parseFailure(
        filename,
        "the PDF is password protected. Please remove the password and re-upload.",
      );
    }
    if (/invalid|corrupt|structure/i.test(message)) {
      throw ApiError.parseFailure(
        filename,
        "the PDF appears to be corrupt or malformed.",
      );
    }

    logger.error("PDF extraction failed", error);
    throw ApiError.parseFailure(filename, message);
  } finally {
    // Must run even on the error path, otherwise pdf.js leaks workers.
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocx(buffer: Buffer, filename: string): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    // extractRawText flattens to plain text and drops styling, which is
    // exactly what we want before embedding.
    const { value, messages } = await mammoth.extractRawText({ buffer });

    // Non-fatal conversion warnings (e.g. dropped images) are worth knowing
    // about but must not fail the upload.
    for (const message of messages.slice(0, 3)) {
      logger.warn(`DOCX conversion warning in ${filename}: ${message.message}`);
    }

    return value;
  } catch (error) {
    logger.error("DOCX extraction failed", error);
    throw ApiError.parseFailure(
      filename,
      error instanceof Error ? error.message : "unknown DOCX error",
    );
  }
}

export async function extractText(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ExtractedDocument> {
  const kind = resolveKind(filename, mimeType);

  logger.debug(
    `Extracting ${kind} from "${filename}" (${buffer.byteLength} bytes)`,
  );

  let text: string;
  switch (kind) {
    case "pdf":
      text = await extractPdf(buffer, filename);
      break;
    case "docx":
      text = await extractDocx(buffer, filename);
      break;
    case "text":
      text = buffer.toString("utf8");
      break;
  }

  // Normalize line endings and collapse runs of blank lines. This meaningfully
  // improves chunk quality, because the splitter keys on "\n\n".
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length < MIN_USABLE_TEXT_CHARS) {
    if (kind === "pdf") {
      throw ApiError.scannedDocument(filename);
    }
    throw ApiError.badRequest(
      `"${filename}" contains almost no readable text (${normalized.length} characters).`,
    );
  }

  logger.info(
    `Extracted ${normalized.length} characters from "${filename}" (${env.CHUNK_SIZE}-char chunks)`,
  );

  return { text: normalized, kind, charCount: normalized.length };
}
