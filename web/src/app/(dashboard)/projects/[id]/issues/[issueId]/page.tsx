import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { safeLevel, TimeAgo } from "@/lib/format";
import { CopyForLlm } from "@/lib/copy-button";
import { breadcrumbs, crumbTime, exceptionValues, messageText, str } from "@/lib/event";
import { issueMarkdown } from "@/lib/llm-export";
import { bucketByHour, Sparkline } from "@/lib/sparkline";
import type {
  EventDoc,
  IssueDoc,
  ProjectDoc,
  SentryBreadcrumb,
  SentryStackFrame,
} from "@/lib/types";
import { deleteIssue, setIssueStatus } from "../../../../actions";

export const dynamic = "force-dynamic";

// Render a key/value block from an arbitrary object, coercing untrusted values.
function KeyValues({ data }: { data: Record<string, unknown> }) {
  const rows = Object.entries(data).filter(([, v]) => v != null && v !== "");
  if (rows.length === 0) return null;
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{k}</dt>
          <dd>{str(v)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Frame({ frame }: { frame: SentryStackFrame }) {
  const where = str(frame.filename ?? frame.module) || "<unknown>";
  const hasCtx = typeof frame.context_line === "string";
  const hasLineNo = typeof frame.lineno === "number";
  const startLine = hasLineNo
    ? frame.lineno! - (hasCtx ? frame.pre_context?.length ?? 0 : 0)
    : null;
  const ctxLines = hasCtx
    ? [...(frame.pre_context ?? []), frame.context_line!, ...(frame.post_context ?? [])]
    : [];
  const curIndex = frame.pre_context?.length ?? 0;

  return (
    <div className={`frame ${frame.in_app === false ? "sys" : ""}`}>
      <div className="frame-head">
        <span className="file">{where}</span>
        {frame.function && (
          <>
            {" in "}
            <span className="fn">{str(frame.function)}</span>
          </>
        )}
        {hasLineNo && ` at line ${frame.lineno}`}
      </div>
      {hasCtx && (
        <pre className="frame-ctx">
          {ctxLines.map((line, i) => (
            <span className={`line ${i === curIndex ? "cur" : ""}`} key={i}>
              <span className="no">{startLine != null ? startLine + i : ""}</span>
              <span>{str(line) || " "}</span>
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; issueId: string }>;
}): Promise<Metadata> {
  const { id, issueId } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || !ObjectId.isValid(issueId)) return { title: "Sentric" };
  const session = await getSession();
  if (!session) return { title: "Sentric" };
  const db = await getDb();
  const project = await db
    .collection<ProjectDoc>("projects")
    .findOne({ projectId, members: session.username });
  if (!project) return { title: "Sentric" };
  const issue = await db
    .collection<IssueDoc>("issues")
    .findOne({ _id: new ObjectId(issueId), projectId });
  return { title: issue ? `${issue.title.slice(0, 60)} – Sentric` : "Sentric" };
}

export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; issueId: string }>;
  searchParams: Promise<{ event?: string; delete?: string }>;
}) {
  const { id, issueId } = await params;
  const { event: eventParam, delete: deleteParam } = await searchParams;
  const confirmDelete = deleteParam === "1";

  const session = await getSession();
  if (!session) redirect("/login");

  const projectId = Number(id);
  if (!Number.isInteger(projectId) || !ObjectId.isValid(issueId)) notFound();

  const db = await getDb();
  const project = await db
    .collection<ProjectDoc>("projects")
    .findOne({ projectId, members: session.username });
  const issue = await db
    .collection<IssueDoc>("issues")
    .findOne({ _id: new ObjectId(issueId), projectId });
  if (!project || !issue) notFound();

  const events = await db
    .collection<EventDoc>("events")
    .find({ issueId: issue._id })
    .sort({ receivedAt: -1 })
    .limit(20)
    .toArray();

  // 24h event volume for this issue, bucketed by hour.
  const since = new Date(Date.now() - 24 * 3_600_000);
  const volume = await db
    .collection<EventDoc>("events")
    .aggregate<{ _id: number; count: number }>([
      { $match: { issueId: issue._id, receivedAt: { $gte: since } } },
      {
        $group: {
          _id: {
            $floor: { $divide: [{ $toLong: "$receivedAt" }, 3_600_000] },
          },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();
  const buckets = bucketByHour(
    volume.map((v) => ({ hour: v._id, count: v.count })),
    24
  );

  const selected = events.find((e) => e.eventId === eventParam) ?? events[0];
  const values = selected ? exceptionValues(selected.payload) : [];
  const message = selected ? messageText(selected.payload) : null;
  const crumbs = selected ? breadcrumbs(selected.payload) : [];
  const request = selected?.payload.request;
  const userCtx = selected?.payload.user;
  const contexts = selected?.payload.contexts ?? {};
  const tagLabel = issue.status === "resolved" ? "resolved" : safeLevel(issue.level);

  const toggle = setIssueStatus.bind(
    null,
    projectId,
    issue._id.toString(),
    issue.status === "open" ? "resolved" : "open"
  );

  // Built here rather than in the browser so the client bundle stays free of the
  // event payload; the button only ever receives the finished string.
  const llmMarkdown = issueMarkdown({ project, issue, event: selected });

  const meta: [string, string][] = selected
    ? [
        ["event id", selected.eventId],
        ["timestamp", selected.timestamp.toISOString()],
        ["platform", str(selected.payload.platform)],
        ["release", str(selected.payload.release)],
        ["environment", str(selected.payload.environment)],
        ["server", str(selected.payload.server_name)],
        [
          "sdk",
          selected.payload.sdk?.name
            ? `${str(selected.payload.sdk.name)} ${str(selected.payload.sdk.version)}`
            : "",
        ],
        ...Object.entries(selected.payload.tags ?? {}).map(
          ([k, v]) => [`tag:${k}`, str(v)] as [string, string]
        ),
      ]
    : [];

  return (
    <>
      <p className="crumbs">
        <Link href="/">Projects</Link> /{" "}
        <Link href={`/projects/${projectId}`}>{project.name}</Link> / issue
      </p>

      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="wrap">{issue.title}</h1>
          <div className="muted wrap" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
            {issue.culprit || "—"}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <span className={`tag ${tagLabel}`}>{tagLabel}</span>
            {issue.regressed && issue.status === "open" && (
              <span className="tag regressed" title="This issue was resolved and came back">
                regression
              </span>
            )}
            <span className="muted" style={{ fontSize: 12.5 }}>
              {issue.count.toLocaleString()} events · first{" "}
              <TimeAgo date={issue.firstSeen} /> · last <TimeAgo date={issue.lastSeen} />
            </span>
          </div>
        </div>
        <div className="head-actions">
          <div className="chart-24h">
            <Sparkline buckets={buckets} width={150} height={34} title="Events, last 24 hours" />
            <span className="muted chart-label">last 24h</span>
          </div>
          <CopyForLlm
            text={llmMarkdown}
            title="Copy this issue as markdown — stack trace, context and breadcrumbs — to paste into an LLM"
          />
          <form action={toggle} className="inline-form">
            <button type="submit" className={issue.status === "open" ? "primary" : ""}>
              {issue.status === "open" ? "Resolve" : "Reopen"}
            </button>
          </form>
          {confirmDelete ? (
            <span className="confirm-row">
              <form action={deleteIssue.bind(null, projectId, issueId)} className="inline-form">
                <button type="submit" className="danger">
                  Confirm delete
                </button>
              </form>
              <Link
                href={`/projects/${projectId}/issues/${issueId}`}
                className="muted"
              >
                cancel
              </Link>
            </span>
          ) : (
            <Link
              href={`/projects/${projectId}/issues/${issueId}?delete=1`}
              className="btn-link-danger"
            >
              Delete
            </Link>
          )}
        </div>
      </div>

      {!selected && (
        <p className="empty">
          No stored events for this issue (raw events expire after 30 days; counts are
          kept).
        </p>
      )}

      {message && values.length === 0 && (
        <>
          <h2>Message</h2>
          <div className="panel wrap" style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
            {message}
          </div>
        </>
      )}

      {values.map((exc, i) => {
        // frames arrive oldest → newest; show newest (top of stack) first
        const frames = [...(exc.stacktrace?.frames ?? [])].reverse();
        return (
          <section key={i}>
            <h2 className="wrap">
              {str(exc.type) || "Exception"}
              {exc.value && <span className="muted"> — {str(exc.value)}</span>}
            </h2>
            {frames.length > 0 ? (
              <div className="frames">
                {frames.map((f, j) => (
                  <Frame frame={f} key={j} />
                ))}
              </div>
            ) : (
              <p className="muted">No stacktrace.</p>
            )}
          </section>
        );
      })}

      {selected && (
        <>
          <h2>Details</h2>
          <div className="panel">
            <dl className="kv">
              {meta
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <Fragment key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </Fragment>
                ))}
            </dl>
          </div>
        </>
      )}

      {request && (
        <>
          <h2>Request</h2>
          <div className="panel">
            {request.url && (
              <p className="req-url wrap">
                <span className="req-method">{str(request.method) || "GET"}</span>{" "}
                {str(request.url)}
                {request.query_string ? `?${str(request.query_string)}` : ""}
              </p>
            )}
            {request.headers && Object.keys(request.headers).length > 0 && (
              <details className="sub-details">
                <summary>Headers ({Object.keys(request.headers).length})</summary>
                <KeyValues data={request.headers as Record<string, unknown>} />
              </details>
            )}
            {request.data != null && request.data !== "" && (
              <details className="sub-details">
                <summary>Body</summary>
                <pre className="frame-ctx wrap">{str(request.data)}</pre>
              </details>
            )}
          </div>
        </>
      )}

      {userCtx && Object.keys(userCtx).length > 0 && (
        <>
          <h2>User</h2>
          <div className="panel">
            <KeyValues data={userCtx as Record<string, unknown>} />
          </div>
        </>
      )}

      {Object.keys(contexts).length > 0 && (
        <>
          <h2>Context</h2>
          <div className="ctx-grid">
            {Object.entries(contexts).map(([name, values]) => (
              <div className="panel" key={name}>
                <div className="ctx-name">{name}</div>
                <KeyValues
                  data={
                    (values && typeof values === "object"
                      ? (values as Record<string, unknown>)
                      : { value: values }) as Record<string, unknown>
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}

      {crumbs.length > 0 && (
        <>
          <h2>Breadcrumbs</h2>
          <div className="crumbs-list">
            {/* newest last, matching the order they happened before the error */}
            {crumbs.map((c, i) => (
              <div className={`crumb ${safeLevel(str(c.level) || "info")}`} key={i}>
                <span className="crumb-time">{crumbTime(c.timestamp)}</span>
                <span className="crumb-cat">{str(c.category) || str(c.type) || "—"}</span>
                <span className="crumb-msg wrap">
                  {str(c.message) ||
                    (c.data ? str(c.data) : <span className="muted">(no message)</span>)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {events.length > 1 && (
        <>
          <h2>Recent events</h2>
          <div>
            {events.map((e) => (
              <div className="row" key={e.eventId} style={{ padding: "7px 16px" }}>
                <div className="grow">
                  <Link
                    href={`/projects/${projectId}/issues/${issueId}?event=${encodeURIComponent(e.eventId)}`}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      fontWeight: e.eventId === selected?.eventId ? 700 : 400,
                    }}
                  >
                    {e.eventId}
                  </Link>
                </div>
                <span className="meta">
                  <TimeAgo date={e.receivedAt} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
