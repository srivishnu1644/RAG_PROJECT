import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Types,
} from "mongoose";

/**
 * A single embedded chunk. `embeddingVector` MUST be named exactly as
 * VECTOR_PATH in .env and declared with the same dimensions in the Atlas
 * index definition, or $vectorSearch will fail.
 */
const chunkSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    chunkIndex: { type: Number, required: true, min: 0 },
    text: { type: String, required: true },
    /** Filename denormalized so citations need no extra join. */
    filename: { type: String, required: true },
    chars: { type: Number, required: true, min: 0 },
    embeddingVector: {
      type: [Number],
      required: true,
      // Guard rail: a wrong-width vector would otherwise be written happily
      // and only fail much later at query time.
      validate: {
        validator: (value: number[]) => value.length > 0,
        message: "embeddingVector must not be empty",
      },
    },
  },
  { timestamps: true },
);

export type ChunkAttrs = InferSchemaType<typeof chunkSchema>;
export type ChunkDoc = HydratedDocument<ChunkAttrs>;

export const Chunk = model<ChunkAttrs>("Chunk", chunkSchema);

export type { Types };
