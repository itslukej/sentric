"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { MongoServerError, ObjectId } from "mongodb";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ensureWebIndexes, getDb } from "@/lib/db";
import { clearSessionCookie, getSession, type Session } from "@/lib/session";
import type { IssueDoc, ProjectDoc, UserDoc } from "@/lib/types";

async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

async function requireMembership(
  projectId: number,
  session: Session
): Promise<ProjectDoc> {
  const db = await getDb();
  const project = await db
    .collection<ProjectDoc>("projects")
    .findOne({ projectId, members: session.username });
  if (!project) redirect("/");
  return project;
}

export async function createProject(formData: FormData): Promise<void> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/?error=name");

  const db = await getDb();
  const projects = db.collection<ProjectDoc>("projects");

  // Dedupe rapid double-submits: ignore a create identical to one this user made
  // in the last 5s (covers the no-JS path where the button can't be disabled).
  const recent = await projects.findOne({
    name: name.slice(0, 100),
    members: session.username,
    createdAt: { $gt: new Date(Date.now() - 5000) },
  });
  if (recent) redirect(`/?created=${recent.projectId}`);

  await ensureWebIndexes();
  const projectId = await nextProjectId();
  await projects.insertOne({
    projectId,
    name: name.slice(0, 100),
    publicKey: randomBytes(16).toString("hex"),
    members: [session.username],
    createdAt: new Date(),
  });
  redirect(`/?created=${projectId}`);
}

async function nextProjectId(): Promise<number> {
  const db = await getDb();
  const counters = db.collection<{ _id: string; seq: number }>("counters");
  // Retry the one-time race where two concurrent first upserts collide on _id.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const counter = await counters.findOneAndUpdate(
        { _id: "projectId" },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" }
      );
      return counter!.seq;
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) continue;
      throw err;
    }
  }
  throw new Error("could not allocate project id");
}

export async function setIssueStatus(
  projectId: number,
  issueId: string,
  status: "open" | "resolved"
): Promise<void> {
  const session = await requireSession();
  await requireMembership(projectId, session);
  if (status !== "open" && status !== "resolved") redirect(`/projects/${projectId}`);
  if (!ObjectId.isValid(issueId)) redirect(`/projects/${projectId}`);

  const db = await getDb();
  // resolvedAt is the cutoff ingest compares against: events after it reopen the
  // issue as a regression, late events from before the fix don't. Resolving also
  // clears any previous regression marker.
  const changes =
    status === "resolved"
      ? { status, resolvedAt: new Date(), regressed: false }
      : { status, regressed: false };
  await db
    .collection<IssueDoc>("issues")
    .updateOne({ _id: new ObjectId(issueId), projectId }, { $set: changes });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
}

export async function deleteIssue(projectId: number, issueId: string): Promise<void> {
  const session = await requireSession();
  await requireMembership(projectId, session);
  if (!ObjectId.isValid(issueId)) redirect(`/projects/${projectId}`);

  const db = await getDb();
  const _id = new ObjectId(issueId);
  // Events first: if this fails halfway, the issue is still reachable rather
  // than leaving orphaned events with no parent.
  await db.collection("events").deleteMany({ issueId: _id });
  await db.collection<IssueDoc>("issues").deleteOne({ _id, projectId });
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

export async function deleteProject(projectId: number): Promise<void> {
  const session = await requireSession();
  await requireMembership(projectId, session);

  const db = await getDb();
  await db.collection("events").deleteMany({ projectId });
  await db.collection("issues").deleteMany({ projectId });
  await db.collection<ProjectDoc>("projects").deleteOne({ projectId });
  revalidatePath("/");
  redirect("/?deleted=1");
}

export async function rotateProjectKey(projectId: number): Promise<void> {
  const session = await requireSession();
  await requireMembership(projectId, session);

  const db = await getDb();
  await db
    .collection<ProjectDoc>("projects")
    .updateOne(
      { projectId, members: session.username },
      { $set: { publicKey: randomBytes(16).toString("hex") } }
    );
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  redirect(`/projects/${projectId}/settings?rotated=1`);
}

export async function addMember(projectId: number, formData: FormData): Promise<void> {
  const session = await requireSession();
  await requireMembership(projectId, session);
  const username = String(formData.get("username") ?? "").trim();
  if (!username) redirect(`/projects/${projectId}`);

  const db = await getDb();
  const user = await db.collection<UserDoc>("users").findOne({ username });
  if (!user) redirect(`/projects/${projectId}?member=notfound`);

  // Filter on membership so a just-removed user's in-flight action can't mutate.
  await db
    .collection<ProjectDoc>("projects")
    .updateOne(
      { projectId, members: session.username },
      { $addToSet: { members: username } }
    );
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}?member=added`);
}

export async function removeMember(
  projectId: number,
  username: string
): Promise<void> {
  const session = await requireSession();
  await requireMembership(projectId, session);
  // You can't remove yourself — avoids an accidental self-lockout.
  if (username === session.username) redirect(`/projects/${projectId}`);

  const db = await getDb();
  // Pipeline update pulls the member only when more than one remains, so two
  // members concurrently removing each other can never empty `members` and
  // orphan the project (there is no admin path to recover it).
  await db.collection<ProjectDoc>("projects").updateOne(
    { projectId, members: session.username },
    [
      {
        $set: {
          members: {
            $cond: [
              { $gt: [{ $size: "$members" }, 1] },
              { $filter: { input: "$members", cond: { $ne: ["$$this", username] } } },
              "$members",
            ],
          },
        },
      },
    ]
  );
  revalidatePath(`/projects/${projectId}`);
}

export async function changePassword(formData: FormData): Promise<void> {
  const session = await requireSession();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 8) redirect("/account?error=short");
  if (next !== confirm) redirect("/account?error=mismatch");

  const db = await getDb();
  const users = db.collection<UserDoc>("users");
  const user = await users.findOne({ username: session.username });
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
    redirect("/account?error=current");
  }

  await users.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await bcrypt.hash(next, 12) } }
  );
  redirect("/account?changed=1");
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
