import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

export interface AuthenticatedUser {
  userId: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present only after requireAuth has run. */
      user?: AuthenticatedUser;
    }
  }
}

export function signToken(user: AuthenticatedUser): string {
  return jwt.sign({ sub: user.userId, email: user.email }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthenticatedUser {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);

    if (typeof payload === "string" || !payload.sub) {
      throw new Error("Malformed token payload.");
    }

    return {
      userId: String(payload.sub),
      email: typeof payload.email === "string" ? payload.email : "",
    };
  } catch (error) {
    const expired = error instanceof jwt.TokenExpiredError;
    throw ApiError.unauthorized(
      expired
        ? "Your session has expired. Please sign in again."
        : "Invalid authentication token.",
    );
  }
}

/**
 * Every document and every vector query is scoped by req.user.userId.
 * This is the single enforcement point for per-user isolation.
 */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    next(ApiError.unauthorized("Missing Bearer token."));
    return;
  }

  try {
    req.user = verifyToken(header.slice("Bearer ".length).trim());
    next();
  } catch (error) {
    next(error);
  }
}

/** Narrowing helper for handlers that run behind requireAuth. */
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) {
    throw ApiError.unauthorized();
  }
  return req.user;
}
