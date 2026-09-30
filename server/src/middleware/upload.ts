import multer from "multer";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

const MAX_FILE_SIZE_BYTES = env.MAX_FILE_SIZE_MB * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream", // generic fallback; resolveKind() checks the extension
]);

/**
 * Memory storage, not disk.
 *
 * We deliberately buffer the file in memory: the ingestion path is
 * extract -> chunk -> embed -> insert, and it never needs a durable temp file.
 * Buffering also keeps the process stateless across restarts.
 *
 * The size cap is enforced here rather than trusted from the client, so an
 * oversized upload is rejected before we allocate the buffer.
 */
export const uploadSingleDocument = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(
      ApiError.unsupportedMedia(
        `Unsupported file type "${file.mimetype}". Upload a PDF, TXT, MD, or DOCX file.`,
      ),
    );
  },
}).single("file");
