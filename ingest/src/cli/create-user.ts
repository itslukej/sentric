// Sign-up is CLI-only. Usage:
//   docker compose exec ingest node dist/cli/create-user.js <username> <password>
//   npm run create-user -- <username> <password>   (local dev)
import "../env.js";
import bcrypt from "bcryptjs";
import { MongoServerError } from "mongodb";
import { closeDb, ensureIndexes, getDb } from "../db.js";
import type { UserDoc } from "../types.js";

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error("usage: create-user <username> <password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("password must be at least 8 characters");
  process.exit(1);
}

await ensureIndexes();
const db = await getDb();
const users = db.collection<UserDoc>("users");
try {
  await users.insertOne({
    username,
    passwordHash: await bcrypt.hash(password, 12),
    createdAt: new Date(),
  });
  console.log(`created user "${username}"`);
} catch (err) {
  if (err instanceof MongoServerError && err.code === 11000) {
    console.error(`user "${username}" already exists`);
    await closeDb();
    process.exit(1);
  }
  throw err;
}
await closeDb();
process.exit(0);
