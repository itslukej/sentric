import { breadcrumbs, crumbTime, exceptionValues, messageText, str } from "@/lib/event";
import type { EventDoc, IssueDoc, ProjectDoc, SentryStackFrame } from "@/lib/types";

// This text is copied out of the dashboard and pasted into a third-party model,
// so it leaves your infrastructure. Headers that routinely carry credentials are
// replaced rather than copied — the on-page rendering is unaffected.
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-csrf-token)$|token|secret|password|api[-_]?key|session/i;

const MAX_FRAMES = 50;
const MAX_CRUMBS = 40;
const MAX_CHARS = 100_000;

/** Fence long enough that content containing backticks can't break out. */
function fence(body: string): string {
  let ticks = "```";
  while (body.includes(ticks)) ticks += "`";
  return ticks;
}

function codeBlock(body: string, lang = ""): string {
  const f = fence(body);
  return `${f}${lang}\n${body}\n${f}`;
}

function iso(d: Date): string {
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : "";
}

function bullets(rows: [string, string][]): string {
  return rows
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
}

/** `file in fn at line N`, matching how the UI labels a frame. */
function frameLabel(f: SentryStackFrame): string {
  const where = str(f.filename ?? f.module) || "<unknown>";
  const fn = str(f.function);
  const line = typeof f.lineno === "number" ? ` at line ${f.lineno}` : "";
  return `${where}${fn ? ` in ${fn}` : ""}${line}${f.in_app === false ? "  [library]" : ""}`;
}

function frameContext(f: SentryStackFrame): string | null {
  if (typeof f.context_line !== "string") return null;
  const pre = f.pre_context ?? [];
  const lines = [...pre, f.context_line, ...(f.post_context ?? [])];
  const start = typeof f.lineno === "number" ? f.lineno - pre.length : null;
  const width = String((start ?? 1) + lines.length).length;
  const body = lines
    .map((line, i) => {
      const no = start != null ? String(start + i).padStart(width, " ") : "";
      // caret marks the line that actually threw
      return `${i === pre.length ? ">" : " "} ${no} | ${str(line)}`;
    })
    .join("\n");
  return codeBlock(body);
}

function stackSection(frames: SentryStackFrame[]): string {
  // Frames arrive oldest → newest; the throw site is what matters, so lead with it.
  const ordered = [...frames].reverse();
  const shown = ordered.slice(0, MAX_FRAMES);
  const parts = shown.map((f, i) => {
    const ctx = frameContext(f);
    // trailing blank line keeps the next numbered frame out of the code fence
    return `${i + 1}. ${frameLabel(f)}${ctx ? `\n\n${ctx}\n` : ""}`;
  });
  if (ordered.length > shown.length) {
    parts.push(`…${ordered.length - shown.length} more frames omitted.`);
  }
  return parts.join("\n");
}

function kvTable(data: Record<string, unknown>, redact = false): string {
  const rows = Object.entries(data)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => [k, redact && SECRET_HEADER.test(k) ? "[redacted]" : str(v)]);
  if (rows.length === 0) return "";
  return rows.map(([k, v]) => `- ${k}: ${v}`).join("\n");
}

function truncate(md: string): string {
  return md.length <= MAX_CHARS
    ? md
    : `${md.slice(0, MAX_CHARS)}\n\n…truncated at ${MAX_CHARS.toLocaleString()} characters.`;
}

/**
 * A single issue plus one of its events, as markdown aimed at an LLM: enough
 * context to reason about the cause without the reader having seen the app.
 */
export function issueMarkdown({
  project,
  issue,
  event,
}: {
  project: ProjectDoc;
  issue: IssueDoc;
  event?: EventDoc;
}): string {
  const out: string[] = [];

  out.push(`# ${issue.title}`);
  out.push(
    bullets([
      ["Project", project.name],
      ["Culprit", issue.culprit],
      ["Level", issue.level],
      [
        "Status",
        issue.status === "open" && issue.regressed
          ? "open (regression — was resolved, then happened again)"
          : issue.status,
      ],
      ["Events", issue.count.toLocaleString()],
      ["First seen", iso(issue.firstSeen)],
      ["Last seen", iso(issue.lastSeen)],
      ["Releases", (issue.releases ?? []).join(", ")],
      ["Environments", (issue.environments ?? []).join(", ")],
    ])
  );

  if (!event) {
    out.push(
      "No stored event payload for this issue — raw events expire on a retention window, but the counts above are kept."
    );
    return truncate(out.join("\n\n"));
  }

  const values = exceptionValues(event.payload);
  const message = messageText(event.payload);

  out.push(`## Event ${event.eventId} (${iso(event.timestamp)})`);

  if (message && values.length === 0) {
    out.push("### Message", codeBlock(message));
  }

  for (const exc of values) {
    const type = str(exc.type) || "Exception";
    const value = str(exc.value);
    out.push(`### ${type}${value ? `: ${value}` : ""}`);
    const frames = exc.stacktrace?.frames ?? [];
    if (frames.length > 0) {
      out.push("Stack trace, innermost frame first:", stackSection(frames));
    } else {
      out.push("_No stack trace on this exception._");
    }
  }

  const details = bullets([
    ["platform", str(event.payload.platform)],
    ["release", str(event.payload.release)],
    ["environment", str(event.payload.environment)],
    ["server", str(event.payload.server_name)],
    [
      "sdk",
      event.payload.sdk?.name
        ? `${str(event.payload.sdk.name)} ${str(event.payload.sdk.version)}`
        : "",
    ],
    ...Object.entries(event.payload.tags ?? {}).map(
      ([k, v]) => [`tag:${k}`, str(v)] as [string, string]
    ),
  ]);
  if (details) out.push("### Details", details);

  const request = event.payload.request;
  if (request) {
    const lines: string[] = [];
    if (request.url) {
      const qs = request.query_string ? `?${str(request.query_string)}` : "";
      lines.push(`${str(request.method) || "GET"} ${str(request.url)}${qs}`);
    }
    const headers = request.headers
      ? kvTable(request.headers as Record<string, unknown>, true)
      : "";
    if (headers) lines.push(`\nHeaders:\n${headers}`);
    if (request.data != null && request.data !== "") {
      lines.push(`\nBody:\n${codeBlock(str(request.data))}`);
    }
    if (lines.length > 0) out.push("### Request", lines.join("\n"));
  }

  const user = event.payload.user;
  if (user && Object.keys(user).length > 0) {
    const rows = kvTable(user as Record<string, unknown>);
    if (rows) out.push("### User", rows);
  }

  const contexts = event.payload.contexts ?? {};
  const ctxBlocks = Object.entries(contexts)
    .map(([name, values]) => {
      const rows = kvTable(
        values && typeof values === "object"
          ? (values as Record<string, unknown>)
          : { value: values }
      );
      return rows ? `**${name}**\n${rows}` : "";
    })
    .filter(Boolean);
  if (ctxBlocks.length > 0) out.push("### Context", ctxBlocks.join("\n\n"));

  const crumbs = breadcrumbs(event.payload).slice(-MAX_CRUMBS);
  if (crumbs.length > 0) {
    const rows = crumbs.map((c) => {
      const time = crumbTime(c.timestamp);
      const cat = str(c.category) || str(c.type) || "—";
      const msg = str(c.message) || (c.data ? str(c.data) : "");
      return `${time ? `${time}  ` : ""}[${str(c.level) || "info"}] ${cat}: ${msg}`;
    });
    out.push(
      "### Breadcrumbs",
      "What the app did in the lead-up, oldest first:",
      codeBlock(rows.join("\n"))
    );
  }

  return truncate(out.join("\n\n"));
}

/** The visible slice of the issue stream, for triage-style questions. */
export function issueListMarkdown({
  project,
  issues,
  status,
  totalIssues,
  filters,
}: {
  project: ProjectDoc;
  issues: IssueDoc[];
  status: "open" | "resolved";
  totalIssues: number;
  filters: { q?: string; release?: string; environment?: string; tag?: string };
}): string {
  const active = bullets([
    ["search", filters.q ?? ""],
    ["release", filters.release ?? ""],
    ["environment", filters.environment ?? ""],
    ["tag", filters.tag ?? ""],
  ]);

  const out: string[] = [`# ${project.name} — ${status} issues`];

  out.push(
    issues.length === totalIssues
      ? `${totalIssues.toLocaleString()} ${status} issue${totalIssues === 1 ? "" : "s"}, most recently seen first.`
      : `Showing ${issues.length} of ${totalIssues.toLocaleString()} ${status} issues, most recently seen first.`
  );
  if (active) out.push(`Filters applied:\n${active}`);

  if (issues.length === 0) {
    out.push("_Nothing matches._");
    return truncate(out.join("\n\n"));
  }

  out.push(
    issues
      .map((issue, i) => {
        const flags = [
          issue.level,
          issue.regressed && issue.status === "open" ? "regression" : "",
        ]
          .filter(Boolean)
          .join(", ");
        return [
          `${i + 1}. ${issue.title}`,
          `   - ${flags} · ${issue.count.toLocaleString()} event${issue.count === 1 ? "" : "s"}`,
          issue.culprit ? `   - culprit: ${issue.culprit}` : "",
          `   - first seen ${iso(issue.firstSeen)}, last seen ${iso(issue.lastSeen)}`,
          (issue.releases ?? []).length
            ? `   - releases: ${(issue.releases ?? []).join(", ")}`
            : "",
          `   - detail: /projects/${project.projectId}/issues/${issue._id.toString()}`,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n")
  );

  return truncate(out.join("\n\n"));
}
