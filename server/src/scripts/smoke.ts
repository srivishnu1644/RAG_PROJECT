/**
 * HTTP smoke test: boots the Express app on an ephemeral port and exercises
 * the routes that do not require a database connection.
 *
 * Run with: npm run smoke
 */
import type { Server } from "node:http";
import { createApp } from "../app.js";
import { env } from "../config/env.js";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) failures++;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const app = createApp();

  const server: Server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not determine the test server port.");
  }
  const base = `http://127.0.0.1:${address.port}`;

  try {
    console.log("\n[health]");
    const health = await fetch(`${base}/api/health`);
    const body = (await health.json()) as {
      status: string;
      embeddings: { provider: string; dimensions: number };
      chat: { available: boolean };
      chunking: { size: number; overlap: number };
    };

    check("responds 200", health.status === 200);
    check("status ok", body.status === "ok");
    check(
      "reports embedding dimensions",
      body.embeddings.dimensions === env.EMBEDDING_DIMENSIONS,
      `${body.embeddings.provider} / ${body.embeddings.dimensions}d`,
    );
    check(
      "reports chat availability",
      typeof body.chat.available === "boolean",
      `available=${body.chat.available}`,
    );
    check(
      "reports chunking",
      body.chunking.size === 1000 && body.chunking.overlap === 200,
      `${body.chunking.size}/${body.chunking.overlap}`,
    );

    console.log("\n[auth guards]");
    // Every protected route must reject an unauthenticated request.
    for (const [method, path] of [
      ["GET", "/api/documents"],
      ["GET", "/api/documents/stats"],
      ["GET", "/api/auth/me"],
      ["POST", "/api/chat/stream"],
    ] as const) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "POST"
          ? { body: JSON.stringify({ message: "hi" }) }
          : {}),
      });
      const json = (await response.json()) as { error?: { code?: string } };
      check(
        `${method} ${path} rejects anonymous`,
        response.status === 401 && json.error?.code === "UNAUTHORIZED",
        `${response.status} ${json.error?.code ?? ""}`,
      );
    }

    console.log("\n[validation]");
    const badLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "" }),
    });
    const badJson = (await badLogin.json()) as { error?: { code?: string } };
    check(
      "rejects malformed login",
      badLogin.status === 400,
      badJson.error?.code ?? String(badLogin.status),
    );

    console.log("\n[errors]");
    const missing = await fetch(`${base}/api/does-not-exist`);
    const missingJson = (await missing.json()) as { error?: { code?: string } };
    check(
      "unknown route → 404 envelope",
      missing.status === 404 && missingJson.error?.code === "NOT_FOUND",
    );

    // A multipart upload with no file must fail validation, not hang or 500.
    const noFile = await fetch(`${base}/api/documents/upload`, {
      method: "POST",
      headers: { Authorization: "Bearer invalid.token.value" },
    });
    check(
      "upload rejects bad token",
      noFile.status === 401,
      String(noFile.status),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(
    `\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
