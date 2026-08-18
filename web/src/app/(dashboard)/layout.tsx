import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { logout } from "./actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="wordmark">
          sentric
        </Link>
        <nav>
          <Link href="/">Projects</Link>
          <Link href="/account">Account</Link>
        </nav>
        <div className="sidebar-footer">
          <span className="who">{session.username}</span>
          <form action={logout} className="inline-form">
            <button type="submit" className="link-btn">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
