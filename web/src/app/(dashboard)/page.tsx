import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { buildDsn } from "@/lib/dsn";
import { TimeAgo } from "@/lib/format";
import type { ProjectDoc } from "@/lib/types";
import { createProject } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Projects – Sentric" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string; deleted?: string }>;
}) {
  const { created, error, deleted } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");

  const db = await getDb();
  const projects = await db
    .collection<ProjectDoc>("projects")
    .find({ members: session.username })
    .sort({ projectId: 1 })
    .toArray();

  const counts = new Map<number, number>();
  if (projects.length > 0) {
    // Scope to the user's projects so the compound {projectId, status, lastSeen}
    // index serves this instead of a full COLLSCAN over every project's issues.
    const grouped = await db
      .collection("issues")
      .aggregate<{ _id: number; open: number }>([
        {
          $match: {
            projectId: { $in: projects.map((p) => p.projectId) },
            status: "open",
          },
        },
        { $group: { _id: "$projectId", open: { $sum: 1 } } },
      ])
      .toArray();
    for (const g of grouped) counts.set(g._id, g.open);
  }

  const createdProject = created
    ? projects.find((p) => p.projectId === Number(created))
    : undefined;

  return (
    <>
      <div className="page-head">
        <h1>Projects</h1>
        <form action={createProject} className="head-form">
          <input
            type="text"
            name="name"
            placeholder="Project name"
            aria-label="New project name"
            required
          />
          <button type="submit" className="primary">
            Create project
          </button>
        </form>
      </div>

      {error === "name" && (
        <p className="error-msg">Enter a project name.</p>
      )}

      {deleted === "1" && <p className="ok-msg">Project deleted.</p>}

      {createdProject && (
        <div className="panel banner">
          <strong>{createdProject.name}</strong> is ready. Point a Sentry SDK at this DSN:
          <div className="dsn" style={{ marginTop: 8 }}>
            {buildDsn(createdProject.publicKey, createdProject.projectId)}
          </div>
          <p style={{ marginBottom: 0, marginTop: 10, fontSize: 13 }}>
            <Link href={`/projects/${createdProject.projectId}/setup`}>
              Setup instructions →
            </Link>
          </p>
        </div>
      )}

      {projects.length === 0 ? (
        <p className="empty">No projects yet — create one to get a DSN.</p>
      ) : (
        <div>
          {projects.map((p) => (
            <div className="row" key={p.projectId}>
              <div className="grow">
                <div className="title">
                  <Link href={`/projects/${p.projectId}`}>{p.name}</Link>
                </div>
                <details className="dsn-details">
                  <summary>DSN</summary>
                  <div className="dsn">{buildDsn(p.publicKey, p.projectId)}</div>
                </details>
              </div>
              <span className="meta">
                {counts.get(p.projectId) ?? 0} unresolved
                <br />
                created <TimeAgo date={p.createdAt} />
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
