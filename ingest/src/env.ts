import { resolve } from "node:path";
import { config } from "dotenv";

// Local dev reads the repo-root .env (the same file docker compose uses).
// Real environment variables always win over the file, and a missing file is
// fine — so containers, where compose injects everything, are unaffected.
config({ path: resolve(import.meta.dirname, "../../.env"), quiet: true });
