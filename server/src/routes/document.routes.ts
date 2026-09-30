import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { uploadSingleDocument } from "../middleware/upload.js";
import {
  uploadDocument,
  listDocuments,
  deleteDocument,
  getStats,
} from "../controllers/document.controller.js";

export const documentRouter = Router();

// Every document route is authenticated: documents are always user-scoped.
documentRouter.use(requireAuth);

documentRouter.post("/upload", uploadSingleDocument, uploadDocument);
documentRouter.get("/", listDocuments);
documentRouter.get("/stats", getStats);
documentRouter.delete("/:id", deleteDocument);
