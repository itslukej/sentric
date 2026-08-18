import assert from "node:assert/strict";
import { test } from "node:test";
import { culprit, fingerprint, messageText, title } from "./grouping.js";
import type { SentryEvent } from "./types.js";

function exc(value: string, frames: object[] = [], type = "TypeError"): SentryEvent {
  return {
    exception: { values: [{ type, value, stacktrace: { frames } }] },
  } as SentryEvent;
}

test("same error with different numbers groups together", () => {
  assert.equal(
    fingerprint(exc("timeout after 3021ms")),
    fingerprint(exc("timeout after 5ms"))
  );
});

test("uuids and hex addresses are normalized away", () => {
  assert.equal(
    fingerprint(exc("user 6f1c9d2e-4b7a-11ee-be56-0242ac120002 not found")),
    fingerprint(exc("user 0b6e7c11-0000-11ee-be56-0242ac120002 not found"))
  );
  assert.equal(
    fingerprint(exc("bad access at 0xdeadbeef")),
    fingerprint(exc("bad access at 0xcafef00d"))
  );
});

test("genuinely different errors stay apart", () => {
  assert.notEqual(fingerprint(exc("cannot read x")), fingerprint(exc("cannot read y")));
  assert.notEqual(
    fingerprint(exc("boom", [], "TypeError")),
    fingerprint(exc("boom", [], "RangeError"))
  );
});

test("the same message from a different code path is a different issue", () => {
  const a = exc("boom", [{ filename: "a.js", function: "run", in_app: true }]);
  const b = exc("boom", [{ filename: "b.js", function: "run", in_app: true }]);
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test("an exception and a plain message are never the same issue", () => {
  assert.notEqual(
    fingerprint(exc("timeout")),
    fingerprint({ message: "timeout" } as SentryEvent)
  );
});

test("in_app frames are preferred over library frames", () => {
  // Same app frame, different vendor frames below → still one issue.
  const withVendorA = exc("boom", [
    { filename: "node_modules/x.js", function: "wrap", in_app: false },
    { filename: "app.js", function: "main", in_app: true },
  ]);
  const withVendorB = exc("boom", [
    { filename: "node_modules/y.js", function: "other", in_app: false },
    { filename: "app.js", function: "main", in_app: true },
  ]);
  assert.equal(fingerprint(withVendorA), fingerprint(withVendorB));
});

test("events with neither exception nor message fall back to event_id", () => {
  const a = fingerprint({ event_id: "aaa" } as SentryEvent);
  const b = fingerprint({ event_id: "bbb" } as SentryEvent);
  assert.notEqual(a, b);
});

test("both exception shapes (array and {values}) are read", () => {
  const asArray = {
    exception: [{ type: "Error", value: "x", stacktrace: { frames: [] } }],
  } as unknown as SentryEvent;
  const asValues = exc("x", [], "Error");
  assert.equal(fingerprint(asArray), fingerprint(asValues));
});

test("title and culprit are derived from the exception", () => {
  const e = exc("x is not a function", [
    { filename: "app.js", function: "main", in_app: true },
  ]);
  assert.equal(title(e), "TypeError: x is not a function");
  assert.equal(culprit(e), "app.js in main");
});

test("title falls back to the message, then to <unknown>", () => {
  assert.equal(title({ message: "just a message" } as SentryEvent), "just a message");
  assert.equal(title({} as SentryEvent), "<unknown>");
});

test("title is truncated to 200 characters", () => {
  assert.equal(title(exc("y".repeat(500))).length, 200);
});

test("only the first line of a multi-line value is used", () => {
  assert.equal(title(exc("first line\nsecond line")), "TypeError: first line");
});

test("message accepts string, {formatted} and {message} shapes", () => {
  assert.equal(messageText({ message: "a" } as SentryEvent), "a");
  assert.equal(messageText({ message: { formatted: "b" } } as SentryEvent), "b");
  assert.equal(messageText({ message: { message: "c" } } as SentryEvent), "c");
  assert.equal(messageText({} as SentryEvent), null);
});

// Regression guard: payload fields are attacker-controlled and may not be
// strings; these used to throw and 500 the whole envelope.
test("type-confused fields do not throw", () => {
  const hostile = {
    exception: {
      values: [
        {
          type: { a: 1 },
          value: { b: 2 },
          stacktrace: { frames: [{ filename: { c: 3 }, function: [1], in_app: true }] },
        },
      ],
    },
    message: { formatted: { d: 4 } },
  } as unknown as SentryEvent;
  assert.doesNotThrow(() => fingerprint(hostile));
  assert.doesNotThrow(() => title(hostile));
  assert.doesNotThrow(() => culprit(hostile));
  assert.equal(typeof fingerprint(hostile), "string");
});

test("fingerprint is stable across calls", () => {
  const e = exc("same", [{ filename: "a.js", function: "f", in_app: true }]);
  assert.equal(fingerprint(e), fingerprint(e));
});
