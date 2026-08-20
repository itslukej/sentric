import { strict as assert } from "node:assert";
import test from "node:test";
import { ObjectId } from "mongodb";
import { issueListMarkdown, issueMarkdown } from "@/lib/llm-export";
import type { EventDoc, IssueDoc, ProjectDoc } from "@/lib/types";

const project: ProjectDoc = {
  projectId: 7,
  name: "checkout-api",
  publicKey: "k".repeat(32),
  members: ["admin"],
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function issue(over: Partial<IssueDoc> = {}): IssueDoc {
  return {
    _id: new ObjectId("6a83b8b3a9febe925191834b"),
    projectId: 7,
    fingerprint: "f".repeat(40),
    title: "TypeError: boom",
    culprit: "app/x.ts in go",
    level: "error",
    status: "open",
    count: 3,
    firstSeen: new Date("2026-02-01T00:00:00Z"),
    lastSeen: new Date("2026-02-02T00:00:00Z"),
    ...over,
  };
}

function event(payload: EventDoc["payload"]): EventDoc {
  return {
    _id: new ObjectId(),
    issueId: new ObjectId("6a83b8b3a9febe925191834b"),
    projectId: 7,
    eventId: "e".repeat(32),
    timestamp: new Date("2026-02-02T00:00:00Z"),
    level: "error",
    payload,
    receivedAt: new Date("2026-02-02T00:00:00Z"),
  };
}

test("credential-bearing request headers are redacted, ordinary ones kept", () => {
  const md = issueMarkdown({
    project,
    issue: issue(),
    event: event({
      request: {
        url: "https://x.test/a",
        method: "POST",
        headers: {
          Authorization: "Bearer LEAK",
          Cookie: "sid=LEAK",
          "X-Api-Key": "LEAK",
          "x-session-token": "LEAK",
          "Set-Cookie": "a=LEAK",
          "user-password": "LEAK",
          "Content-Type": "application/json",
          "x-request-id": "req-42",
        },
      },
    }),
  });
  assert.ok(!md.includes("LEAK"), "no credential value may reach the clipboard");
  assert.match(md, /Authorization: \[redacted\]/);
  assert.match(md, /Content-Type: application\/json/);
  assert.match(md, /x-request-id: req-42/);
});

test("source context is fenced past any backticks it contains", () => {
  const md = issueMarkdown({
    project,
    issue: issue(),
    event: event({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "boom",
            stacktrace: {
              frames: [
                {
                  filename: "a.ts",
                  function: "go",
                  lineno: 2,
                  pre_context: ["const md = `"],
                  context_line: "```js",
                  post_context: ["`;"],
                },
              ],
            },
          },
        ],
      },
    }),
  });
  // the fence must be longer than any run of backticks in the body
  const fence = md.match(/^(`{3,})$/m);
  assert.ok(fence && fence[1].length > 3, `expected an escaped fence, got ${fence?.[1]}`);
  assert.match(md, /> {0,4}2 \| ```js/);
});

test("frames are listed innermost first", () => {
  const md = issueMarkdown({
    project,
    issue: issue(),
    event: event({
      exception: {
        values: [
          {
            type: "E",
            stacktrace: {
              // Sentry sends oldest → newest; the throw site is last
              frames: [
                { filename: "outer.ts", function: "handler" },
                { filename: "inner.ts", function: "explode" },
              ],
            },
          },
        ],
      },
    }),
  });
  assert.ok(
    md.indexOf("inner.ts") < md.indexOf("outer.ts"),
    "throw site should come first"
  );
  assert.match(md, /1\. inner\.ts in explode/);
});

test("non-string payload values are coerced rather than thrown on", () => {
  const md = issueMarkdown({
    project,
    issue: issue(),
    event: event({
      // attacker-controlled shapes the types claim are strings
      exception: { values: [{ type: { evil: 1 }, value: 42 } as never] },
      user: { id: { nested: true } as never },
      tags: { n: 7 as never },
    }),
  });
  assert.match(md, /\{"evil":1\}/);
  assert.match(md, /tag:n: 7/);
});

test("an issue whose events have expired still exports its counts", () => {
  const md = issueMarkdown({ project, issue: issue({ count: 9001 }) });
  assert.match(md, /Events: 9,001/);
  assert.match(md, /No stored event payload/);
});

test("regression status is spelled out", () => {
  const md = issueMarkdown({ project, issue: issue({ regressed: true }) });
  assert.match(md, /Status: open \(regression/);
});

test("list export names the active filters and the visible slice", () => {
  const md = issueListMarkdown({
    project,
    issues: [issue(), issue({ _id: new ObjectId(), title: "B", count: 1 })],
    status: "open",
    totalIssues: 57,
    filters: { q: "Type", environment: "production" },
  });
  assert.match(md, /Showing 2 of 57 open issues/);
  assert.match(md, /search: Type/);
  assert.match(md, /environment: production/);
  assert.ok(!md.includes("releases:"), "unset facets shouldn't produce empty lines");
  assert.match(md, /1 event\b/); // singular
  assert.match(md, /3 events\b/);
  assert.match(md, /detail: \/projects\/7\/issues\/6a83b8b3a9febe925191834b/);
});
