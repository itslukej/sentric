import "./env.js";
import { serve } from "@hono/node-server";
import { timingSafeEqual } from "node:crypto";
import { gunzip, inflate } from "node:zlib";
import { promisify } from "node:util";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { extractKey } from "./auth.js";
import { closeDb, ensureIndexes, getDb } from "./db.js";
import { parseEnvelope } from "./envelope.js";
import { newEventId, processEvent } from "./process.js";
import type { ProjectDoc, SentryEvent } from "./types.js";

const MAX_BODY_BYTES = 1024 * 1024;

// Async so decompression doesn't block the single event-loop thread; the
// maxOutputLength bound makes the decompressor itself refuse a zip bomb.
const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);

// strict:false makes /envelope and /envelope/ the same route (SDKs use the
// trailing-slash form).
const app = new Hono({ strict: false });

// Ingestion is called from arbitrary origins by browser SDKs, and the DSN key is
// a public write-only credential, so `*` is correct here. No credentials are
// used, so `*` stays valid (it would be rejected with credentials: include).
// Header list mirrors what the official SDKs send across transports.
app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: [
      "Accept",
      "Content-Type",
      "Content-Encoding",
      "Origin",
      "Authorization",
      "X-Requested-With",
      "X-Sentry-Auth",
      "sentry-trace",
      "baggage",
    ],
    // SDKs read these off the response to honour backpressure.
    exposeHeaders: ["X-Sentry-Rate-Limits", "Retry-After"],
    maxAge: 86400, // cache the preflight for a day instead of one per event
  })
);

app.get("/health", (c) => c.json({ ok: true }));

// Returns the decoded body, or null on a decode/size failure. Both size checks
// (raw and decompressed) throw PayloadTooLarge → 413; a bad encoding returns
// null → 400. The raw cap runs *before* decompression so an oversized or
// zip-bomb body is rejected without allocating gigabytes.
async function readBody(c: Context): Promise<Buffer | null> {
  let body = Buffer.from(await c.req.arrayBuffer());
  if (body.length > MAX_BODY_BYTES) throw new PayloadTooLarge();

  const encoding = c.req.header("content-encoding")?.toLowerCase();
  try {
    if (encoding === "gzip")
      body = await gunzipAsync(body, { maxOutputLength: MAX_BODY_BYTES });
    else if (encoding === "deflate")
      body = await inflateAsync(body, { maxOutputLength: MAX_BODY_BYTES });
  } catch (err) {
    // zlib throws ERR_BUFFER_TOO_LARGE when output exceeds maxOutputLength.
    if ((err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw new PayloadTooLarge();
    }
    return null;
  }
  return body;
}

class PayloadTooLarge extends Error {}

async function authenticate(
  c: Context,
  envelopeDsn?: string
): Promise<{ project: ProjectDoc } | { error: Response }> {
  const projectIdRaw = c.req.param("projectId") ?? "";
  // Only canonical decimal ids — Number() would otherwise accept "0x10", "1e3",
  // "" (→0) and other non-canonical forms the UI never generates.
  if (!/^\d+$/.test(projectIdRaw)) {
    return { error: c.json({ error: "unknown project" }, 404) };
  }
  const projectId = Number(projectIdRaw);
  if (!Number.isSafeInteger(projectId)) {
    return { error: c.json({ error: "unknown project" }, 404) };
  }
  const db = await getDb();
  const project = await db
    .collection<ProjectDoc>("projects")
    .findOne({ projectId });
  if (!project) return { error: c.json({ error: "unknown project" }, 404) };

  const key = extractKey({
    authHeader: c.req.header("x-sentry-auth"),
    queryKey: c.req.query("sentry_key"),
    envelopeDsn,
  });
  if (!key || !keysMatch(key, project.publicKey)) {
    return { error: c.json({ error: "invalid sentry_key" }, 401) };
  }
  return { project };
}

// Constant-time compare so the key check isn't timing-observable.
function keysMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

app.post("/api/:projectId/envelope", async (c) => {
  try {
    const body = await readBody(c);
    if (!body) return c.json({ error: "bad content encoding" }, 400);

    let envelope;
    try {
      envelope = parseEnvelope(body);
    } catch {
      return c.json({ error: "malformed envelope" }, 400);
    }

    const auth = await authenticate(
      c,
      typeof envelope.header.dsn === "string" ? envelope.header.dsn : undefined
    );
    if ("error" in auth) return auth.error;

    let lastEventId: string | null = null;
    for (const item of envelope.items) {
      if (item.type !== "event") continue; // sessions, transactions, etc. are discarded
      let event: SentryEvent;
      try {
        event = JSON.parse(item.payload.toString("utf8"));
      } catch {
        continue;
      }
      // Isolate per-item so one malformed event can't 500 the whole envelope
      // (which would make SDKs retry the batch and double-count the good items).
      try {
        lastEventId = await processEvent(auth.project, event);
      } catch (err) {
        console.error("failed to process event", err);
      }
    }
    return c.json({ id: lastEventId ?? newEventId() });
  } catch (err) {
    if (err instanceof PayloadTooLarge) return c.json({ error: "too large" }, 413);
    throw err;
  }
});

app.post("/api/:projectId/store", async (c) => {
  try {
    const body = await readBody(c);
    if (!body) return c.json({ error: "bad content encoding" }, 400);

    const auth = await authenticate(c);
    if ("error" in auth) return auth.error;

    let event: SentryEvent;
    try {
      event = JSON.parse(body.toString("utf8"));
      if (typeof event !== "object" || event === null || Array.isArray(event)) {
        throw new Error("not an object");
      }
    } catch {
      return c.json({ error: "malformed event" }, 400);
    }
    const id = await processEvent(auth.project, event);
    return c.json({ id });
  } catch (err) {
    if (err instanceof PayloadTooLarge) return c.json({ error: "too large" }, 413);
    throw err;
  }
});

const port = Number(process.env.PORT ?? 3001);

await ensureIndexes();
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`sentric-ingest listening on :${port}`);

// Drain in-flight requests and close the Mongo pool on container stop.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    void closeDb().finally(() => process.exit(0));
  });
}
