/** Structured application error with an HTTP status and a stable machine code. */ export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Authentication required"): ApiError {
    return new ApiError(401, "UNAUTHORIZED", message);
  }

  static forbidden(
    message = "You do not have access to this resource",
  ): ApiError {
    return new ApiError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Resource not found"): ApiError {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, "CONFLICT", message);
  }

  static payloadTooLarge(message: string): ApiError {
    return new ApiError(413, "PAYLOAD_TOO_LARGE", message);
  }

  static unsupportedMedia(message: string): ApiError {
    return new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", message);
  }

  /** The document has no extractable text layer (e.g. a scanned/image-only PDF). */
  static scannedDocument(filename: string): ApiError {
    return new ApiError(
      422,
      "SCANNED_DOCUMENT",
      `"${filename}" appears to be a scanned or image-only document, so it has no text to index. ` +
        "Please upload a PDF with a real text layer, or a .txt/.docx file.",
    );
  }

  static parseFailure(filename: string, reason: string): ApiError {
    return new ApiError(
      422,
      "PARSE_FAILED",
      `Could not read "${filename}": ${reason}`,
    );
  }

  /** The Atlas vector search index is missing, still building, or dimension-mismatched. */
  static vectorIndexUnavailable(reason: string): ApiError {
    return new ApiError(
      503,
      "VECTOR_INDEX_NOT_READY",
      `Vector search is unavailable: ${reason}`,
    );
  }

  static llmUnavailable(reason: string): ApiError {
    return new ApiError(
      502,
      "LLM_UNAVAILABLE",
      `The language model is unavailable: ${reason}`,
    );
  }
}
