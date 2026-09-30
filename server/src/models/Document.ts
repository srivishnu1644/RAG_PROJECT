import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Types,
} from "mongoose";

/** One uploaded file. Chunks live in a separate collection for index isolation. */
const documentSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    filename: { type: String, required: true },
    /** MIME type as reported by the browser; may be generic for .docx/.txt. */
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 0 },
    charCount: { type: Number, required: true, min: 0 },
    chunkCount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["ready", "failed"],
      default: "ready",
      required: true,
    },
  },
  { timestamps: true },
);

// A user should not be able to list the same filename twice in their library.
documentSchema.index({ userId: 1, filename: 1 }, { unique: true });

export type DocumentAttrs = InferSchemaType<typeof documentSchema>;
export type DocumentDoc = HydratedDocument<DocumentAttrs>;

export const DocumentModel = model<DocumentAttrs>("Document", documentSchema);

export type { Types };
