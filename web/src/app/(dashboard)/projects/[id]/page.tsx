import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Filter } from "mongodb";
import { getDb } from "@/lib/db";
import { buildDsn } from "@/lib/dsn";
import { safeLevel, TimeAgo } from "@/lib/format";
import { SetupInstructions } from "@/lib/setup";
import { bucketByHour, Sparkline } from "@/lib/sparkline";
import { getSession } from "@/lib/session";
import type { EventDoc, IssueDoc, ProjectDoc } from "@/lib/types";
import { addMember, removeMember, setIssueStatus } from "../../actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) return { title: "Sentric" };
  const session = await getSession();
  if (!session) return { title: "Sentric" };
  const db = await getDb();
  const project = await db
    .collection<ProjectDoc>("projects")
    .findOne({ projectId, members: session.username });
  return { title: project ? `${project.name} – Sentric` : "Sentric" };
}

// Substring search beats $text here: people search for fragments like
// "undefined" or "TypeError", which a stemmed text index wouldn't match.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    status?: string;
    member?: string;
    confirm?: string;
    page?: string;
    q?: string;
    release?: string;
    environment?: string;
    tag?: string;
    platform?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const status = sp.status === "resolved" ? "resolved" : "open";
  const page = Math.max(0, Number(sp.page) || 0);
  const q = (sp.q ?? "").trim();

  const session = await getSession();
  if (!session) redirect("/login");

  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const db = await getDb();
  const project = await db
    .collection<ProjectDoc>("projects")
    .findOne({ projectId, members: session.username });
  if (!project) notFound();

  const query: Filter<IssueDoc> = { projectId, status };
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    query.$or = [{ title: rx }, { culprit: rx }];
  }
  if (sp.release) query.releases = sp.release;
  if (sp.environment) query.environments = sp.environment;
  if (sp.tag) query.tags = sp.tag;

  const issuesCol = db.collection<IssueDoc>("issues");
  const totalIssues = await issuesCol.countDocuments(query);
  const issues = await issuesCol
    .find(query)
    .sort({ lastSeen: -1 })
    .skip(page * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();

  // One aggregation covers the sparklines for every row on this page.
  const since = new Date(Date.now() - 24 * 3_600_000);
  const volume = issues.length
    ? await db
        .collection<EventDoc>("events")
        .aggregate<{ _id: { issue: string; hour: number }; count: number }>([
          {
            $match: {
              issueId: { $in: issues.map((i) => i._id) },
              receivedAt: { $gte: since },
            },
          },
          {
            $group: {
              _id: {
                issue: "$issueId",
                hour: { $floor: { $divide: [{ $toLong: "$receivedAt" }, 3_600_000] } },
              },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray()
    : [];
  const perIssue = new Map<string, { hour: number; count: number }[]>();
  for (const row of volume) {
    const key = String(row._id.issue);
    const list = perIssue.get(key) ?? [];
    list.push({ hour: row._id.hour, count: row.count });
    perIssue.set(key, list);
  }

  // Facet options come from the issues actually in this project.
  const [releases, environments, tags] = (
    await Promise.all([
      issuesCol.distinct("releases", { projectId }),
      issuesCol.distinct("environments", { projectId }),
      issuesCol.distinct("tags", { projectId }),
    ])
  ).map((vals) => vals.filter((v): v is string => typeof v === "string").sort());

  // A project that has never received anything gets the setup guide instead of
  // an empty table. Only checked when there's nothing to show anyway.
  const nothingToShow = issues.length === 0 && !q && !sp.release && !sp.environment && !sp.tag;
  const awaitingFirstEvent =
    nothingToShow &&
    status === "open" &&
    (await db.collection("events").countDocuments({ projectId }, { limit: 1 })) === 0 &&
    (await db.collection("issues").countDocuments({ projectId }, { limit: 1 })) === 0;

  const totalPages = Math.ceil(totalIssues / PAGE_SIZE);
  const params0 = new URLSearchParams();
  if (status === "resolved") params0.set("status", "resolved");
  if (q) params0.set("q", q);
  if (sp.release) params0.set("release", sp.release);
  if (sp.environment) params0.set("environment", sp.environment);
  if (sp.tag) params0.set("tag", sp.tag);
  const withParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params0);
    if (v === null) p.delete(k);
    else p.set(k, v);
    p.delete("page");
    const s = p.toString();
    return `/projects/${projectId}${s ? `?${s}` : ""}`;
  };
  const pageHref = (n: number) => {
    const p = new URLSearchParams(params0);
    if (n > 0) p.set("page", String(n));
    const s = p.toString();
    return `/projects/${projectId}${s ? `?${s}` : ""}`;
  };
  const hasFilters = Boolean(q || sp.release || sp.environment || sp.tag);

  return (
    <>
      <p className="crumbs">
        <Link href="/">Projects</Link> / {project.name}
      </p>
      <div className="page-head">
        <h1>{project.name}</h1>
        <div className="head-actions">
          <details className="members-box" {...(sp.member ? { open: true } : {})}>
            <summary>Members ({project.members.length})</summary>
            <div className="members-pop">
              {sp.member === "added" && <p className="ok-msg">Member added.</p>}
              {sp.member === "notfound" && (
                <p className="error-msg">No user with that username.</p>
              )}
              {project.members.map((m) => (
                <div className="member-row" key={m}>
                  <span>
                    {m}
                    {m === session.username && <span className="muted"> (you)</span>}
                  </span>
                  {m !== session.username &&
                    (sp.confirm === m ? (
                      <span className="confirm-row">
                        <form
                          action={removeMember.bind(null, projectId, m)}
                          className="inline-form"
                        >
                          <button type="submit" className="link-danger">
                            confirm
                          </button>
                        </form>
                        <Link href={`/projects/${projectId}?member=1`} className="muted">
                          cancel
                        </Link>
                      </span>
                    ) : (
                      <Link
                        href={`/projects/${projectId}?member=1&confirm=${encodeURIComponent(m)}`}
                        className="link-danger"
                      >
                        remove
                      </Link>
                    ))}
                </div>
              ))}
              <form action={addMember.bind(null, projectId)} className="member-add">
                <input
                  type="text"
                  name="username"
                  placeholder="Username"
                  aria-label="Username to add"
                  required
                />
                <button type="submit" className="primary">
                  Add
                </button>
              </form>
            </div>
          </details>
          <Link href={`/projects/${projectId}/setup`} className="btn-link">
            Setup
          </Link>
          <Link href={`/projects/${projectId}/settings`} className="btn-link">
            Settings
          </Link>
        </div>
      </div>

      {awaitingFirstEvent && (
        <WaitingForFirstEvent
          dsn={buildDsn(project.publicKey, project.projectId)}
          projectId={projectId}
          platform={sp.platform}
        />
      )}

      {!awaitingFirstEvent && (
      <>
      <div className="toolbar">
        <div className="btn-bar">
          <Link href={withParam("status", null)} className={status === "open" ? "active" : ""}>
            Unresolved
          </Link>
          <Link
            href={withParam("status", "resolved")}
            className={status === "resolved" ? "active" : ""}
          >
            Resolved
          </Link>
        </div>
        <form method="GET" action={`/projects/${projectId}`} className="search-form">
          {status === "resolved" && <input type="hidden" name="status" value="resolved" />}
          {sp.release && <input type="hidden" name="release" value={sp.release} />}
          {sp.environment && (
            <input type="hidden" name="environment" value={sp.environment} />
          )}
          {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search issues…"
            aria-label="Search issues"
          />
          <button type="submit">Search</button>
        </form>
      </div>

      {(releases.length > 0 || environments.length > 0 || tags.length > 0) && (
        <div className="facets">
          <FacetGroup label="Release" values={releases} current={sp.release} param="release" href={withParam} />
          <FacetGroup
            label="Environment"
            values={environments}
            current={sp.environment}
            param="environment"
            href={withParam}
          />
          <FacetGroup label="Tag" values={tags} current={sp.tag} param="tag" href={withParam} />
        </div>
      )}

      {hasFilters && (
        <p className="filter-note">
          {totalIssues.toLocaleString()} match{totalIssues === 1 ? "" : "es"}
          {q && (
            <>
              {" for "}
              <strong>{q}</strong>
            </>
          )}{" "}
          · <Link href={`/projects/${projectId}`}>clear filters</Link>
        </p>
      )}

      {issues.length === 0 ? (
        <p className="empty">
          {hasFilters
            ? "No issues match these filters."
            : status === "open"
              ? "No unresolved issues — nothing is broken, or nothing is reporting yet."
              : "No resolved issues yet."}
        </p>
      ) : (
        <div className="itable" role="table" aria-label={`${status} issues`}>
          <div className="itable-head" role="row">
            <span role="columnheader" aria-label="Level" />
            <span role="columnheader">Issue</span>
            <span role="columnheader">Last 24h</span>
            <span role="columnheader">Events</span>
            <span role="columnheader">Last seen</span>
            <span role="columnheader" aria-label="Actions" />
          </div>
          {issues.map((issue) => {
            const issueId = issue._id.toString();
            const level = safeLevel(issue.level);
            const toggle = setIssueStatus.bind(
              null,
              projectId,
              issueId,
              issue.status === "open" ? "resolved" : "open"
            );
            return (
              <div className="itable-row" role="row" key={issueId}>
                <span role="cell" className={`dot ${level}`}>
                  <span className="sr-only">{level}</span>
                </span>
                <div role="cell" style={{ minWidth: 0 }}>
                  <Link className="ititle" href={`/projects/${projectId}/issues/${issueId}`}>
                    {issue.title}
                  </Link>
                  <div className="iculprit">
                    {issue.regressed && issue.status === "open" && (
                      <span className="mini-tag">regression</span>
                    )}
                    {issue.culprit || " "}
                  </div>
                </div>
                <span role="cell" className="spark-cell">
                  <Sparkline buckets={bucketByHour(perIssue.get(issueId) ?? [], 24)} />
                </span>
                <span role="cell" className="num">
                  {issue.count.toLocaleString()}
                </span>
                <div role="cell" className="times">
                  <TimeAgo date={issue.lastSeen} />
                  <br />
                  <span className="muted">
                    first <TimeAgo date={issue.firstSeen} />
                  </span>
                </div>
                <form role="cell" action={toggle} className="inline-form">
                  <button type="submit">
                    {issue.status === "open" ? "Resolve" : "Reopen"}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="pager">
          {page > 0 ? <Link href={pageHref(page - 1)}>← Newer</Link> : <span className="muted">← Newer</span>}
          <span className="muted">
            Page {page + 1} of {totalPages} · {totalIssues.toLocaleString()} issues
          </span>
          {page + 1 < totalPages ? (
            <Link href={pageHref(page + 1)}>Older →</Link>
          ) : (
            <span className="muted">Older →</span>
          )}
        </div>
      )}
      </>
      )}
    </>
  );
}

// Shown until the very first event lands. The meta refresh polls without any
// client JS, so the page flips to the issue list on its own.
function WaitingForFirstEvent({
  dsn,
  projectId,
  platform,
}: {
  dsn: string;
  projectId: number;
  platform?: string;
}) {
  return (
    <>
      <meta httpEquiv="refresh" content="5" />
      <div className="waiting">
        <span className="pulse" aria-hidden="true" />
        <div>
          <strong>Waiting for the first event…</strong>
          <div className="muted" style={{ fontSize: 13 }}>
            This page refreshes itself — send an error and it will appear here.
          </div>
        </div>
      </div>

      <h2>Get started</h2>
      <p className="muted" style={{ marginTop: -4 }}>
        Sentric speaks the Sentry protocol, so use the official Sentry SDKs and point the
        DSN here.
      </p>
      <div className="panel">
        <div className="dsn">{dsn}</div>
      </div>
      <SetupInstructions
        dsn={dsn}
        platform={platform}
        hrefFor={(p) => `/projects/${projectId}?platform=${p}`}
      />
    </>
  );
}

function FacetGroup({
  label,
  values,
  current,
  param,
  href,
}: {
  label: string;
  values: string[];
  current?: string;
  param: string;
  href: (k: string, v: string | null) => string;
}) {
  if (values.length === 0) return null;
  return (
    <div className="facet-group">
      <span className="facet-label">{label}</span>
      {values.slice(0, 8).map((v) => (
        <Link
          key={v}
          href={href(param, current === v ? null : v)}
          className={`facet ${current === v ? "active" : ""}`}
        >
          {v}
        </Link>
      ))}
    </div>
  );
}
