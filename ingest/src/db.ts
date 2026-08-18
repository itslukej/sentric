import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017/sentric";

// Cache the connect *promise*, not the resolved client, so concurrent first
// callers share one connection attempt instead of each constructing a client.
let clientPromise: Promise<MongoClient> | null = null;

export async function getDb(): Promise<Db> {
  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect().catch((err) => {
      clientPromise = null; // let the next call retry a failed connect
      throw err;
    });
  }
  return (await clientPromise).db();
}

export async function closeDb(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise.catch(() => null);
    clientPromise = null;
    await client?.close();
  }
}

export async function ensureIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("projects").createIndex({ projectId: 1 }, { unique: true });
  await db.collection("projects").createIndex({ publicKey: 1 }, { unique: true });
  await db.collection("projects").createIndex({ members: 1 });
  await db
    .collection("issues")
    .createIndex({ projectId: 1, fingerprint: 1 }, { unique: true });
  await db.collection("issues").createIndex({ projectId: 1, status: 1, lastSeen: -1 });
  // Facet filters (release / environment / tag) on the issue stream.
  await db.collection("issues").createIndex({ projectId: 1, releases: 1 });
  await db.collection("issues").createIndex({ projectId: 1, environments: 1 });
  await db.collection("issues").createIndex({ projectId: 1, tags: 1 });
  await db.collection("events").createIndex({ issueId: 1, receivedAt: -1 });
  // Serves the 24h event-volume aggregation for the issue stream.
  await db.collection("events").createIndex({ projectId: 1, receivedAt: -1 });
  // Dedupe retried deliveries of the same event within a project.
  await db.collection("events").createIndex({ projectId: 1, eventId: 1 }, { unique: true });
  await ensureTtlIndex(db);
  await migrateLegacyMembers(db);
}

const RETENTION_DAYS = Number(process.env.EVENT_RETENTION_DAYS ?? 30);
export const EVENT_TTL_SECONDS =
  60 * 60 * 24 * (Number.isFinite(RETENTION_DAYS) && RETENTION_DAYS > 0 ? RETENTION_DAYS : 30);

// createIndex errors (code 85) if a receivedAt index exists with a different
// expireAfterSeconds, which would crash-loop the service; reconcile with collMod.
async function ensureTtlIndex(db: Db): Promise<void> {
  try {
    await db
      .collection("events")
      .createIndex({ receivedAt: 1 }, { expireAfterSeconds: EVENT_TTL_SECONDS });
  } catch (err) {
    if ((err as { code?: number }).code === 85) {
      await db.command({
        collMod: "events",
        index: { keyPattern: { receivedAt: 1 }, expireAfterSeconds: EVENT_TTL_SECONDS },
      });
    } else {
      throw err;
    }
  }
}

// Projects created before membership existed were visible to everyone, so
// grandfather them in with all current users as members. Guarded on a non-empty
// user set so a fresh DB (restored projects, no users yet) can't bake in an
// empty members array that would orphan the project forever.
async function migrateLegacyMembers(db: Db): Promise<void> {
  const legacy = await db
    .collection("projects")
    .countDocuments({ members: { $exists: false } });
  if (legacy === 0) return;
  const usernames = await db.collection("users").distinct("username");
  if (usernames.length === 0) return;
  await db
    .collection("projects")
    .updateMany({ members: { $exists: false } }, { $set: { members: usernames } });
}
