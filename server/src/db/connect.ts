import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

let cached: typeof mongoose | null = null;

export async function connectDatabase(): Promise<typeof mongoose> {
  if (cached) return cached;

  mongoose.set("strictQuery", true);

  const connection = await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB,
    serverSelectionTimeoutMS: 10_000,
  });

  cached = mongoose;
  logger.info(`MongoDB connected → database "${env.MONGODB_DB}"`);
  return connection;
}

export async function disconnectDatabase(): Promise<void> {
  if (cached) {
    await mongoose.disconnect();
    cached = null;
    logger.info("MongoDB disconnected");
  }
}
