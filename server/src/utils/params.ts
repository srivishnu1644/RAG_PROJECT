import { Types } from "mongoose";
import { ApiError } from "./ApiError.js";

/**
 * Express 5 types `req.params[k]` as `string | string[]` because a pattern can
 * match repeatedly. Every route here is a single-segment capture, so we narrow
 * once here instead of casting at each call site.
 */
export function routeParam(
  value: string | string[] | undefined,
  name: string,
): string {
  const resolved = Array.isArray(value) ? value[0] : value;

  if (typeof resolved !== "string" || resolved.length === 0) {
    throw ApiError.badRequest(`Missing route parameter "${name}".`);
  }
  return resolved;
}

/** Narrows and validates a route parameter that should be an ObjectId. */
export function objectIdParam(
  value: string | string[] | undefined,
  name: string,
): Types.ObjectId {
  const resolved = routeParam(value, name);

  if (!Types.ObjectId.isValid(resolved)) {
    throw ApiError.badRequest(`Invalid ${name}.`);
  }
  return new Types.ObjectId(resolved);
}
