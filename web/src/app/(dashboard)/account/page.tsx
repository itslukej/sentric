import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { TimeAgo } from "@/lib/format";
import { getSession } from "@/lib/session";
import type { UserDoc } from "@/lib/types";
import { changePassword } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account – Sentric" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string; error?: string }>;
}) {
  const { changed, error } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");

  const db = await getDb();
  const user = await db
    .collection<UserDoc>("users")
    .findOne({ username: session.username });
  if (!user) redirect("/login");

  return (
    <>
      <div className="page-head">
        <h1>Account</h1>
      </div>

      <div className="panel">
        <dl className="kv">
          <dt>username</dt>
          <dd>{user.username}</dd>
          <dt>created</dt>
          <dd>
            <TimeAgo date={user.createdAt} />
          </dd>
        </dl>
      </div>

      <h2>Change password</h2>
      <div className="panel">
        {changed === "1" && <p className="ok-msg">Password updated.</p>}
        {error === "current" && (
          <p className="error-msg">Current password is incorrect.</p>
        )}
        {error === "short" && (
          <p className="error-msg">New password must be at least 8 characters.</p>
        )}
        {error === "mismatch" && <p className="error-msg">New passwords don’t match.</p>}
        <form action={changePassword} className="stack-form">
          <input
            type="password"
            name="current"
            placeholder="Current password"
            aria-label="Current password"
            autoComplete="current-password"
            required
          />
          <input
            type="password"
            name="next"
            placeholder="New password"
            aria-label="New password"
            autoComplete="new-password"
            required
          />
          <input
            type="password"
            name="confirm"
            placeholder="Confirm new password"
            aria-label="Confirm new password"
            autoComplete="new-password"
            required
          />
          <button type="submit" className="primary">
            Update password
          </button>
        </form>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          Changing your password does not sign out other sessions — they expire on their
          own within 7 days.
        </p>
      </div>
    </>
  );
}
