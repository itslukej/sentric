import type { Metadata } from "next";
import { login } from "./actions";

export const metadata: Metadata = { title: "Sign in – Sentric" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; u?: string }>;
}) {
  const { error, u } = await searchParams;
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="wordmark-dark">sentric</div>
        <p className="tagline">Sign in to continue</p>
        <form action={login}>
          <input
            name="username"
            type="text"
            placeholder="Username"
            aria-label="Username"
            autoComplete="username"
            defaultValue={u ?? ""}
            autoFocus
            required
          />
          <input
            name="password"
            type="password"
            placeholder="Password"
            aria-label="Password"
            autoComplete="current-password"
            required
          />
          <button type="submit" className="primary">
            Sign in
          </button>
        </form>
        {error && <p className="error-msg">Invalid username or password.</p>}
        <p className="cli-hint">
          Accounts are created from the CLI:
          <br />
          <code>docker compose exec ingest node dist/cli/create-user.js …</code>
        </p>
      </div>
    </div>
  );
}
