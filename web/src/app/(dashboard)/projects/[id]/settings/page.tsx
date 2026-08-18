import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { buildDsn } from "@/lib/dsn";
import { getSession } from "@/lib/session";
import type { ProjectDoc } from "@/lib/types";
import { deleteProject, rotateProjectKey } from "../../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Project settings – Sentric" };

export default async function ProjectSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rotated?: string; confirm?: string }>;
}) {
  const { id } = await params;
  const { rotated, confirm } = await searchParams;

  const session = await getSession();
  if (!session) redirect("/login");

  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const db = await getDb();
  const project = await db
    .collection<ProjectDoc>("projects")
    .findOne({ projectId, members: session.username });
  if (!project) notFound();

  const issueCount = await db.collection("issues").countDocuments({ projectId });

  return (
    <>
      <p className="crumbs">
        <Link href="/">Projects</Link> /{" "}
        <Link href={`/projects/${projectId}`}>{project.name}</Link> / settings
      </p>
      <div className="page-head">
        <h1>{project.name} settings</h1>
      </div>

      <h2>DSN</h2>
      <div className="panel">
        {rotated === "1" && (
          <p className="ok-msg">
            Key rotated. Update your apps — the old DSN is rejected from now on.
          </p>
        )}
        <div className="dsn">{buildDsn(project.publicKey, project.projectId)}</div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          Rotating generates a new key and immediately invalidates the old one. Any app
          still using the old DSN will get 401s until you redeploy it.
        </p>
        <form action={rotateProjectKey.bind(null, projectId)} style={{ marginTop: 10 }}>
          <button type="submit">Rotate key</button>
        </form>
      </div>

      <h2>Danger zone</h2>
      <div className="panel danger-zone">
        <p style={{ marginTop: 0 }}>
          Deleting this project removes it along with{" "}
          <strong>{issueCount.toLocaleString()}</strong> issue
          {issueCount === 1 ? "" : "s"} and every stored event. This cannot be undone.
        </p>
        {confirm === "delete" ? (
          <span className="confirm-row">
            <form action={deleteProject.bind(null, projectId)} className="inline-form">
              <button type="submit" className="danger">
                Yes, delete {project.name}
              </button>
            </form>
            <Link href={`/projects/${projectId}/settings`} className="muted">
              cancel
            </Link>
          </span>
        ) : (
          <Link
            href={`/projects/${projectId}/settings?confirm=delete`}
            className="btn-link-danger"
          >
            Delete project
          </Link>
        )}
      </div>
    </>
  );
}
