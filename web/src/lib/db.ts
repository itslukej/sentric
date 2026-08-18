import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017/sentric";

// Cache the connect *promise* (not the resolved client) on globalThis so dev
// HMR doesn't leak connections and concurrent first callers share one attempt.
const globalForMongo = globalThis as unknown as {
  _mongoPromise?: Promise<MongoClient>;
};

export async function getDb(): Promise<Db> {
  if (!globalForMongo._mongoPromise) {
    globalForMongo._mongoPromise = new MongoClient(uri).connect().catch((err) => {
      globalForMongo._mongoPromise = undefined; // let the next call retry
      throw err;
    });
  }
  return (await globalForMongo._mongoPromise).db();
}

// Defense-in-depth: the web app can run against a DB that ingest hasn't booted
// yet, so make sure the uniqueness constraints createProject relies on exist.
export async function ensureWebIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("projects").createIndex({ projectId: 1 }, { unique: true });
  await db.collection("projects").createIndex({ publicKey: 1 }, { unique: true });
  await db.collection("projects").createIndex({ members: 1 });
}
