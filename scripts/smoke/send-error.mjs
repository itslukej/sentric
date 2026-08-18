// Smoke test: exercises the real Sentry SDK AND asserts Sentric actually
// ingested the data (SDK flush alone succeeds even against a broken server, so
// it can't stand in for a real check).
//   DSN=http://<publicKey>@localhost:3001/<projectId> node send-error.mjs
import * as Sentry from "@sentry/node";

const DSN = process.env.DSN;
if (!DSN) {
  console.error("set DSN, e.g. DSN=http://<key>@localhost:3001/1");
  process.exit(1);
}
const { username: publicKey, host, pathname } = new URL(DSN);
const projectId = pathname.replace(/\//g, "");
const base = `http://${host}`;

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}`);
  if (!cond) failures++;
}

// 1. Real SDK path — proves the wire format we emit is accepted.
Sentry.init({ dsn: DSN, release: "smoke@1.0.0", environment: "dev", tracesSampleRate: 0 });
Sentry.setTag("smoke", "true");
try {
  JSON.parse("{definitely-not-json");
} catch (err) {
  Sentry.captureException(err);
}
Sentry.captureMessage("smoke test message", "warning");
check("SDK flushed", await Sentry.flush(5000));

// 2. Raw protocol assertions against Sentric itself (what the SDK can't tell us).
const eventId = "smoke" + Date.now().toString(16).padStart(27, "0").slice(-27);
const store = await fetch(`${base}/api/${projectId}/store/?sentry_key=${publicKey}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ event_id: eventId, message: "raw smoke", level: "error" }),
});
const body = await store.json().catch(() => ({}));
check("store returns 200", store.status === 200);
check("store echoes event id", body.id === eventId);

const badKey = await fetch(`${base}/api/${projectId}/store/?sentry_key=${"0".repeat(32)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "should be rejected" }),
});
check("wrong key rejected (401)", badKey.status === 401);

console.log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
