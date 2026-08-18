// User administration. Sign-up and account state are CLI-only by design —
// there is no admin role in the dashboard.
//   node dist/cli/users.js list
//   node dist/cli/users.js disable <username>
//   node dist/cli/users.js enable <username>
//   node dist/cli/users.js delete <username>
import "../env.js";
import { closeDb, getDb } from "../db.js";
import type { ProjectDoc, UserDoc } from "../types.js";

const [command, username] = process.argv.slice(2);
const db = await getDb();
const users = db.collection<UserDoc>("users");

function usage(): never {
  console.error("usage: users list | disable <username> | enable <username> | delete <username>");
  process.exit(1);
}

async function setDisabled(name: string, disabled: boolean): Promise<void> {
  const res = await users.updateOne({ username: name }, { $set: { disabled } });
  if (res.matchedCount === 0) {
    console.error(`no such user "${name}"`);
    await closeDb();
    process.exit(1);
  }
  console.log(`${disabled ? "disabled" : "enabled"} "${name}"`);
}

switch (command) {
  case "list": {
    const all = await users.find().sort({ username: 1 }).toArray();
    if (all.length === 0) console.log("(no users)");
    for (const u of all) {
      const projects = await db
        .collection<ProjectDoc>("projects")
        .countDocuments({ members: u.username });
      const state = u.disabled ? "disabled" : "active";
      console.log(
        `${u.username.padEnd(20)} ${state.padEnd(9)} ${projects} project(s)  created ${u.createdAt.toISOString().slice(0, 10)}`
      );
    }
    break;
  }
  case "disable":
    if (!username) usage();
    await setDisabled(username, true);
    break;
  case "enable":
    if (!username) usage();
    await setDisabled(username, false);
    break;
  case "delete": {
    if (!username) usage();
    // Refuse to strand a project with no members — there is no admin recovery path.
    const orphaned = await db
      .collection<ProjectDoc>("projects")
      .countDocuments({ members: [username] });
    if (orphaned > 0) {
      console.error(
        `"${username}" is the only member of ${orphaned} project(s). Add another member first, or delete those projects.`
      );
      await closeDb();
      process.exit(1);
    }
    const res = await users.deleteOne({ username });
    if (res.deletedCount === 0) {
      console.error(`no such user "${username}"`);
      await closeDb();
      process.exit(1);
    }
    await db
      .collection<ProjectDoc>("projects")
      .updateMany({ members: username }, { $pull: { members: username } });
    console.log(`deleted "${username}"`);
    break;
  }
  default:
    usage();
}

await closeDb();
process.exit(0);
