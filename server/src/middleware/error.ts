import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}`));
}

/**
 * Terminal error handler. Every failure path in the app funnels through here
 * and leaves as a predictable JSON envelope the frontend can render directly.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "Something went wrong on our end.";
  let details: unknown;

  if (error instanceof ApiError) {
    status = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof multer.MulterError) {
    // Translating multer's codes into our envelope keeps the UI simple: it
    // only ever has to read error.message.
    if (error.code === "LIMIT_FILE_SIZE") {
      status = 413;
      code = "PAYLOAD_TOO_LARGE";
      message = `File is too large. The maximum size is ${env.MAX_FILE_SIZE_MB}MB.`;
    } else {
      status = 400;
      code = "UPLOAD_FAILED";
      message = error.message;
    }
  } else if (error instanceof ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "The request body failed validation.";
    details = error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
  } else {
    // Unexpected: log the full stack server-side, but never leak internals
    // (stack traces, driver messages) to the client.
    logger.error("Unhandled error", error);
    if (env.isProduction) {
      message = "Something went wrong on our end.";
    } else if (error instanceof Error) {
      message = error.message;
      details = error.stack;
    }
  }

  const body: ErrorBody = { error: { code, message } };
  if (details !== undefined) body.error.details = details;

  res.status(status).json(body);
}
