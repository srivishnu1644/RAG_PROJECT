# Axiom — RAG Document Search

A production-ready Retrieval-Augmented Generation application over the MERN stack.
Upload your own documents, then ask questions and get answers grounded in the
exact passages retrieved from your files — with verifiable citations.

> Architecture follows `MERN_RAG_Architecture.pdf` (the ingestion "write" path and
> the retrieval "read" path), with the deviations listed under
> [Differences from the spec](#differences-from-the-spec).

---

## Stack

| Layer      | Technology                                                              |
| ---------- | ----------------------------------------------------------------------- |
| Frontend   | React 19, Vite 8, TypeScript 7, Tailwind CSS 4, Motion (`motion/react`) |
| Backend    | Node 24, Express 5, TypeScript 7, Multer 2                              |
| Extraction | `pdf-parse` 2 (PDF), `mammoth` 1 (DOCX), built-in (TXT/MD)              |
| Chunking   | `@langchain/textsplitters` — 1000 chars / 200 overlap                   |
| Embeddings | `@huggingface/transformers` (local MiniLM, free) or Gemini              |
| Chat       | Gemini 2.5 Flash (streaming)                                            |
| Database   | MongoDB Atlas with Vector Search                                        |

---

## Quick start

### 1. Prerequisites

- **Node.js 20.16+ or 22.3+** (Node 21 is not supported by `pdf-parse`)
- A **free MongoDB Atlas M0 cluster**
- A **free Gemini API key** → https://aistudio.google.com/apikey

### 2. Create the Atlas vector search index (required)

In Atlas: **Database → your cluster → Search Indexes → Create Index → Vector Search**

```json
{
  "name": "vector_index",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "embeddingVector",
        "numDimensions": 384,
        "similarity": "cosine"
      },
      { "type": "filter", "path": "userId" },
      { "type": "filter", "path": "documentId" }
    ]
  }
}
```

Apply it to the **`chunks`** collection.

> **Important.** `numDimensions` must be exactly `384` and the two filter fields
> are mandatory. Without the filter fields, `$vectorSearch` rejects any query that
> filters by `userId`, which would break per-user isolation. The index takes a few
> minutes to become queryable — the app returns a clear
> `VECTOR_INDEX_NOT_READY` message until then.

### 3. Configure the backend

```bash
cd backend
cp .env.example .env
```

Fill in at minimum:

```env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority
JWT_SECRET=<a long random string>
GEMINI_API_KEY=<your free Gemini key>
```

### 4. Run

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

Open http://localhost:5173, create an account, and upload a document.

The first embedding request downloads the MiniLM model (~90 MB) into
`../.models-cache`; it is loaded once at boot and cached for later runs.

---

## Verifying the installation

```bash
cd backend
npm run doctor     # confirms pdf-parse v2 API + real 384-dim normalized vectors
npx tsx src/scripts/selftest.ts   # env, extraction, chunking, vector helpers
```

`npm run doctor` is worth running first: it prints the actual embedding
dimensions and whether they are unit-normalized, which is the single most common
cause of silently poor search quality.

---

## Project layout

```
backend/
  src/
    config/env.ts              zod-validated env, fails fast at boot
    controllers/               auth, document (write path), chat (SSE read path)
    db/connect.ts              mongoose connection
    middleware/                auth (JWT), upload (multer), error handler
    models/                    User, Document, Chunk
    routes/                    /api/auth, /api/documents, /api/chat
    services/
      extract.ts               per-format text extraction
      chunker.ts               RecursiveCharacterTextSplitter
      vectorSearch.ts          $vectorSearch aggregation + error diagnosis
      embeddings/              provider interface + local & Gemini impls
      llm/                     provider interface + Gemini streaming impl
    scripts/                   doctor.ts, selftest.ts
    app.ts / server.ts

frontend/
  src/
    components/                AppShell, AuthScreen, Dropzone, DocumentList
      chat/                    ChatPane, MessageBubble, Composer, SourceList
      ui/                      Button, Shimmer
    contexts/                  AuthContext, ToastContext
    lib/                       api.ts, sse.ts, types.ts
    App.tsx / main.tsx / index.css
```

---

## API

| Method | Route                   | Purpose                                      |
| ------ | ----------------------- | -------------------------------------------- |
| POST   | `/api/auth/register`    | Create account → JWT                         |
| POST   | `/api/auth/login`       | Sign in → JWT                                |
| GET    | `/api/auth/me`          | Current user                                 |
| POST   | `/api/documents/upload` | Multipart upload → extract/chunk/embed/store |
| GET    | `/api/documents`        | List the current user's library              |
| GET    | `/api/documents/stats`  | Chunk counts and embedding metadata          |
| DELETE | `/api/documents/:id`    | Delete document and its chunks               |
| POST   | `/api/chat/stream`      | SSE: sources + streamed tokens + `[DONE]`    |
| GET    | `/api/health`           | Provider and dimension reporting             |

All errors share one envelope, which the frontend renders directly:

```json
{ "error": { "code": "VECTOR_INDEX_NOT_READY", "message": "…" } }
```

---

## How the RAG pipeline works

**Write path** — `POST /api/documents/upload`

1. Multer buffers the file in memory (25 MB cap, MIME allowlist)
2. `extract.ts` pulls text out per format and normalizes whitespace
3. `RecursiveCharacterTextSplitter` cuts it into 1000-character chunks with 200 overlap
4. Each chunk is embedded (batched 16 at a time) into a 384-dimension unit vector
5. Chunks and a `Document` record are written to MongoDB

**Read path** — `POST /api/chat/stream`

1. The question is embedded with the same model
2. `$vectorSearch` returns the top 5 chunks, pre-filtered by `userId`
3. A grounded system prompt is built from those chunks
4. Gemini streams the answer token-by-token as SSE; the UI renders it live
5. If the client disconnects, the request is aborted so no tokens are billed

---

## Differences from the spec

Two deliberate, documented deviations from `MERN_RAG_Architecture.pdf`:

1. **384 dimensions instead of 1536.** The spec assumes OpenAI
   `text-embedding-3-small`. This build defaults to local MiniLM so it costs
   $0 to run. The Atlas `numDimensions` must match — change both together.
2. **Filter fields added to the index.** The spec's index JSON declares only the
   vector field. Per-user retrieval requires `userId` (and `documentId`) to be
   declared as `{"type": "filter"}` fields, or Atlas errors on the query.

---

## Notes and limitations

- **Scanned PDFs are rejected** with a clear error rather than silently
  ingesting zero chunks. There is no OCR in this build.
- **No conversation history is persisted**; refreshing clears the transcript.
- **No rate limiting** on auth or chat endpoints.
- `EMBEDDING_PROVIDER=local` costs nothing and needs no API key. Set it to
  `gemini` to use Gemini embeddings (also 384-dim, so no re-indexing needed).
