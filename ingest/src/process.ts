import { randomUUID } from "node:crypto";
import { MongoServerError, type ObjectId } from "mongodb";
import { getDb } from "./db.js";
import { culprit, fingerprint, title } from "./grouping.js";
import type { EventDoc, IssueDoc, ProjectDoc, SentryEvent } from "./types.js";

const MAX_PAYLOAD_BYTES = 200 * 1024;
const MAX_BREADCRUMBS = 20;

// Sentry event ids are undashed 32-char hex UUIDs.
export function newEventId(): string {
  return randomUUID().replaceAll("-", "");
}

const MAX_FACETS = 50;

// Facet values come from untrusted payloads: coerce to a bounded string.
function asFacet(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : String(v);
  return s.slice(0, 100);
}

// Union new values into an existing facet array, capped so an attacker sending
// unbounded distinct values can't grow the issue document without limit.
function capFacet(existing: unknown, ...values: string[]) {
  const wanted = values.filter(Boolean);
  if (wanted.length === 0) return existing;
  return { $slice: [{ $setUnion: [existing, wanted] }, MAX_FACETS] };
}

function parseTimestamp(ts: SentryEvent["timestamp"]): Date {
  if (typeof ts === "number" && Number.isFinite(ts)) {
    const d = new Date(ts * 1000);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function trimPayload(event: SentryEvent): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...event };
  delete copy.debug_meta;
  const bc = copy.breadcrumbs as SentryEvent["breadcrumbs"];
  if (bc) {
    const values = Array.isArray(bc) ? bc : bc.values;
    if (Array.isArray(values) && values.length > MAX_BREADCRUMBS) {
      copy.breadcrumbs = { values: values.slice(-MAX_BREADCRUMBS) };
    }
  }
  if (Buffer.byteLength(JSON.stringify(copy), "utf8") > MAX_PAYLOAD_BYTES) {
    return {
      event_id: copy.event_id,
      level: copy.level,
      platform: copy.platform,
      exception: copy.exception,
      message: copy.message,
      tags: copy.tags,
      release: copy.release,
      environment: copy.environment,
      sdk: copy.sdk,
      _truncated: true,
    };
  }
  return copy;
}

export async function processEvent(
  project: ProjectDoc,
  event: SentryEvent
): Promise<string> {
  const db = await getDb();
  const issues = db.collection<IssueDoc>("issues");
  const events = db.collection<EventDoc>("events");

  const fp = fingerprint(event);
  const ts = parseTimestamp(event.timestamp);
  const level = typeof event.level === "string" ? event.level : "error";
  const eventId = (typeof event.event_id === "string" ? event.event_id : newEventId())
    .toLowerCase();

  // Client timestamps drive issue ordering, so clamp to server time: a future
  // timestamp must not pin an issue to the top of the list. The raw client ts is
  // still stored on the event itself below.
  const now = new Date();
  const issueTs = ts > now ? now : ts;

  // Facets kept on the issue so the dashboard can filter without scanning
  // events. Capped so a client sending unbounded values can't grow the doc.
  const release = asFacet(event.release);
  const environment = asFacet(event.environment);
  const eventTags = Object.entries(
    (event.tags ?? {}) as Record<string, unknown>
  )
    .map(([k, v]) => `${k}:${asFacet(v)}`.slice(0, 120))
    .filter((t) => !t.endsWith(":"));

  // An aggregation pipeline (rather than plain operators) so the resolved →
  // open regression check can be expressed atomically in the same write.
  const wasResolved = { $eq: [{ $ifNull: ["$status", "open"] }, "resolved"] };
  const beforeFix = { $lte: [issueTs, { $ifNull: ["$resolvedAt", new Date(0)] }] };
  const update = [
    {
      $set: {
        projectId: project.projectId,
        fingerprint: fp,
        level,
        title: title(event),
        culprit: culprit(event),
        count: { $add: [{ $ifNull: ["$count", 0] }, 1] },
        firstSeen: { $ifNull: ["$firstSeen", issueTs] },
        // a delayed client timestamp must not drag lastSeen backwards
        lastSeen: { $max: [{ $ifNull: ["$lastSeen", issueTs] }, issueTs] },
        // A resolved issue that happens again reopens as a regression, unless
        // the event predates the resolution (a late delivery from before the fix).
        status: {
          $cond: [{ $and: [wasResolved, beforeFix] }, "resolved", "open"],
        },
        regressed: {
          $cond: [
            { $and: [wasResolved, { $not: beforeFix }] },
            true,
            { $ifNull: ["$regressed", false] },
          ],
        },
        releases: capFacet({ $ifNull: ["$releases", []] }, release),
        environments: capFacet({ $ifNull: ["$environments", []] }, environment),
        tags: capFacet({ $ifNull: ["$tags", []] }, ...eventTags),
      },
    },
  ];
  const filter = { projectId: project.projectId, fingerprint: fp };

  let issueId: ObjectId;
  try {
    const res = await issues.findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: "after",
    });
    issueId = res!._id;
  } catch (err) {
    // Concurrent upserts on the same new fingerprint can race on the unique
    // index; one retry always succeeds against the now-existing document.
    if (err instanceof MongoServerError && err.code === 11000) {
      const res = await issues.findOneAndUpdate(filter, update, {
        returnDocument: "after",
      });
      issueId = res!._id;
    } else {
      throw err;
    }
  }

  try {
    await events.insertOne({
      issueId,
      projectId: project.projectId,
      eventId,
      timestamp: ts,
      level,
      payload: trimPayload(event),
      receivedAt: new Date(),
    });
  } catch (err) {
    // Duplicate eventId → this is a retried delivery we already stored. Undo the
    // count increment above so retries don't inflate the permanent issue count.
    if (err instanceof MongoServerError && err.code === 11000) {
      await issues.updateOne({ _id: issueId }, { $inc: { count: -1 } });
      return eventId;
    }
    throw err;
  }
  return eventId;
}
