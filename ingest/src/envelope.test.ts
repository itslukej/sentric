import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnvelope } from "./envelope.js";

function envelope(...lines: (string | Buffer)[]): Buffer {
  return Buffer.concat(
    lines.map((l) => (Buffer.isBuffer(l) ? l : Buffer.from(l, "utf8")))
  );
}

test("parses a length-prefixed event item", () => {
  const payload = JSON.stringify({ event_id: "abc", message: "hi" });
  const bytes = Buffer.from(payload, "utf8");
  const env = envelope(
    '{"dsn":"http://k@localhost/1"}\n',
    `{"type":"event","length":${bytes.length}}\n`,
    bytes,
    "\n"
  );
  const { header, items } = parseEnvelope(env);
  assert.equal(header.dsn, "http://k@localhost/1");
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "event");
  assert.equal(JSON.parse(items[0].payload.toString("utf8")).message, "hi");
});

test("length is a BYTE count, not a character count", () => {
  // 'héllo wörld' is 11 characters but 13 bytes in UTF-8. A char-based parser
  // would desync here and corrupt every following item.
  const payload = JSON.stringify({ msg: "héllo wörld" });
  const bytes = Buffer.from(payload, "utf8");
  assert.notEqual(bytes.length, payload.length);
  const env = envelope(
    "{}\n",
    `{"type":"event","length":${bytes.length}}\n`,
    bytes,
    "\n",
    '{"type":"session"}\n',
    '{"status":"ok"}\n'
  );
  const { items } = parseEnvelope(env);
  assert.deepEqual(
    items.map((i) => i.type),
    ["event", "session"]
  );
  assert.equal(JSON.parse(items[0].payload.toString("utf8")).msg, "héllo wörld");
});

test("items without a length run to the next newline", () => {
  const env = envelope(
    "{}\n",
    '{"type":"event"}\n',
    '{"event_id":"1"}\n',
    '{"type":"event"}\n',
    '{"event_id":"2"}\n'
  );
  const { items } = parseEnvelope(env);
  assert.equal(items.length, 2);
  assert.equal(JSON.parse(items[1].payload.toString("utf8")).event_id, "2");
});

test("payload without a trailing newline at EOF is accepted", () => {
  const env = envelope("{}\n", '{"type":"event"}\n', '{"event_id":"last"}');
  const { items } = parseEnvelope(env);
  assert.equal(items.length, 1);
  assert.equal(JSON.parse(items[0].payload.toString("utf8")).event_id, "last");
});

test("a zero-length item is valid", () => {
  const env = envelope("{}\n", '{"type":"attachment","length":0}\n', "\n");
  const { items } = parseEnvelope(env);
  assert.equal(items.length, 1);
  assert.equal(items[0].payload.length, 0);
});

test("trailing blank lines are tolerated", () => {
  const env = envelope("{}\n", '{"type":"event"}\n', '{"event_id":"1"}\n', "\n");
  assert.equal(parseEnvelope(env).items.length, 1);
});

test("an item with no type is kept as unknown rather than dropped", () => {
  const env = envelope("{}\n", "{}\n", '{"event_id":"1"}\n');
  assert.equal(parseEnvelope(env).items[0].type, "unknown");
});

// Regression guard: a negative length used to rewind the cursor and spin the
// parser forever, which was an unauthenticated DoS.
test("rejects a negative item length instead of looping forever", () => {
  const env = envelope("{}\n", '{"type":"x","length":-15}\n');
  assert.throws(() => parseEnvelope(env), /invalid envelope item length/);
});

test("rejects a length past the end of the buffer", () => {
  const env = envelope("{}\n", '{"type":"event","length":99999}\n', "{}");
  assert.throws(() => parseEnvelope(env), /invalid envelope item length/);
});

test("rejects a non-integer length", () => {
  const env = envelope("{}\n", '{"type":"event","length":1.5}\n', "{}");
  assert.throws(() => parseEnvelope(env), /invalid envelope item length/);
});

test("malformed JSON in a header line throws (handler turns this into a 400)", () => {
  assert.throws(() => parseEnvelope(envelope("not json\n")));
});
