import type { Request, Response } from "express";
import { Types } from "mongoose";
import { Chunk } from "../models/Chunk.js";
import { DocumentModel } from "../models/Document.js";
import { currentUser } from "../middleware/auth.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";
import { extractText } from "../services/extract.js";
import { chunkText } from "../services/chunker.js";
import { embeddings } from "../services/embeddings/index.js";
import { objectIdParam } from "../utils/params.js";
import { env } from "../config/env.js";

/** How many chunks to embed per round trip. Keeps peak memory bounded. */
const EMBED_BATCH_SIZE = 16;

/**
 * The write path: extract -> chunk -> embed -> persist.
 */
export async function uploadDocument(
  req: Request,
  res: Response,
): Promise<void> {
  const { userId } = currentUser(req);
  const file = req.file;

  if (!file) {
    throw ApiError.badRequest(
      'No file was provided. Attach a file under the "file" field.',
    );
  }

  const duplicate = await DocumentModel.findOne({
    userId,
    filename: file.originalname,
  }).lean();
  if (duplicate) {
    throw ApiError.conflict(
      `"${file.originalname}" is already in your library. Delete it first to re-upload.`,
    );
  }

  // ── 1. Extract ──────────────────────────────────────────────────────────
  const extracted = await extractText(
    file.buffer,
    file.originalname,
    file.mimetype,
  );

  // ── 2. Chunk ────────────────────────────────────────────────────────────
  const chunks = await chunkText(extracted.text, "pending");

  // ── 3. Embed (batched) ──────────────────────────────────────────────────
  const documentId = new Types.ObjectId();
  const embedded: number[][] = [];

  for (let index = 0; index < chunks.length; index += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(index, index + EMBED_BATCH_SIZE);
    const vectors = await embeddings.embedDocuments(
      batch.map((chunk) => chunk.text),
    );
    embedded.push(...vectors);
  }

  if (embedded.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch: ${embedded.length} vectors for ${chunks.length} chunks.`,
    );
  }

  // ── 4. Persist ──────────────────────────────────────────────────────────
  try {
    await Chunk.insertMany(
      chunks.map((chunk, index) => ({
        userId: new Types.ObjectId(userId),
        documentId,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        filename: file.originalname,
        chars: chunk.chars,
        embeddingVector: embedded[index],
      })),
    );

    const document = await DocumentModel.create({
      _id: documentId,
      userId: new Types.ObjectId(userId),
      filename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      charCount: extracted.charCount,
      chunkCount: chunks.length,
      status: "ready",
    });

    logger.info(
      `Indexed "${file.originalname}" for ${userId}: ${chunks.length} chunks, ` +
        `${embedded[0]?.length ?? 0} dims`,
    );

    res.status(201).json({
      document: {
        id: document.id,
        filename: document.filename,
        sizeBytes: document.sizeBytes,
        charCount: document.charCount,
        chunkCount: document.chunkCount,
        createdAt: document.createdAt,
      },
    });
  } catch (error) {
    // Roll back: chunks without a parent document would be invisible in the
    // library but still retrievable by the vector search.
    await Chunk.deleteMany({ documentId }).catch(() => undefined);
    throw error;
  }
}

export async function listDocuments(
  req: Request,
  res: Response,
): Promise<void> {
  const { userId } = currentUser(req);

  const documents = await DocumentModel.find({
    userId: new Types.ObjectId(userId),
  })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    documents: documents.map((document) => ({
      id: document._id.toString(),
      filename: document.filename,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      charCount: document.charCount,
      chunkCount: document.chunkCount,
      status: document.status,
      createdAt: document.createdAt,
    })),
  });
}

export async function deleteDocument(
  req: Request,
  res: Response,
): Promise<void> {
  const { userId } = currentUser(req);
  const documentId = objectIdParam(req.params["id"], "document id");
  const objectId = documentId;

  const document = await DocumentModel.findOneAndDelete({
    _id: objectId,
    // Scoping the delete by userId prevents one user deleting another's file.
    userId: new Types.ObjectId(userId),
  });

  if (!document) {
    throw ApiError.notFound("Document not found in your library.");
  }

  const { deletedCount } = await Chunk.deleteMany({
    documentId: objectId,
    userId: new Types.ObjectId(userId),
  });

  logger.info(`Deleted "${document.filename}" and ${deletedCount} chunks`);

  res.json({ deleted: true, chunksRemoved: deletedCount });
}

export async function getStats(_req: Request, res: Response): Promise<void> {
  const { userId } = currentUser(_req);

  const [documentCount, chunkCount] = await Promise.all([
    DocumentModel.countDocuments({ userId: new Types.ObjectId(userId) }),
    Chunk.countDocuments({ userId: new Types.ObjectId(userId) }),
  ]);

  res.json({
    documentCount,
    chunkCount,
    embeddingProvider: embeddings.name,
    embeddingDimensions: embeddings.dimensions,
    chunkSize: env.CHUNK_SIZE,
    chunkOverlap: env.CHUNK_OVERLAP,
  });
}
