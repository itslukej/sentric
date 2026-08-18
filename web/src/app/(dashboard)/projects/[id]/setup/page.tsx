import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { buildDsn } from "@/lib/dsn";
import { getSession } from "@/lib/session";
import { SetupInstructions } from "@/lib/setup";
import type { ProjectDoc } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Setup – Sentric" };

export default async function SetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ platform?: string }>;
}) {
  const { id } = await params;
  const { platform } = await searchParams;

  const session = await getSession();
  if (!session) redirect("/login");

  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const db = await getDb();
  const project = await db
    .collection<ProjectDoc>("projects")
    .findOne({ projectId, members: session.username });
  if (!project) notFound();

  const dsn = buildDsn(project.publicKey, project.projectId);
  const eventCount = await db.collection("events").countDocuments({ projectId });

  return (
    <>
      <p className="crumbs">
        <Link href="/">Projects</Link> /{" "}
        <Link href={`/projects/${projectId}`}>{project.name}</Link> / setup
      </p>
      <div className="page-head">
        <h1>Configure {project.name}</h1>
      </div>

      <p className="muted" style={{ marginTop: -8 }}>
        Sentric speaks the Sentry protocol, so you use the official Sentry SDKs — just
        point the DSN here instead of at sentry.io.
      </p>

      <h2>Your DSN</h2>
      <div className="panel">
        <div className="dsn">{dsn}</div>
      </div>

      <h2>Install</h2>
      <SetupInstructions
        dsn={dsn}
        platform={platform}
        hrefFor={(p) => `/projects/${projectId}/setup?platform=${p}`}
      />

      {eventCount > 0 ? (
        <p className="ok-msg" style={{ marginTop: 16 }}>
          This project has received {eventCount.toLocaleString()} event
          {eventCount === 1 ? "" : "s"} —{" "}
          <Link href={`/projects/${projectId}`}>view issues</Link>.
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 16 }}>
          No events received yet. The{" "}
          <Link href={`/projects/${projectId}`}>issues page</Link> will update
          automatically once the first one arrives.
        </p>
      )}
    </>
  );
}
