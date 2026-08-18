// Extract the Sentry public key from a request, per the SDK transport spec.
// SDKs send it via the X-Sentry-Auth header, the ?sentry_key= query param,
// or (envelope endpoint only) a full `dsn` in the envelope header line.

export function keyFromAuthHeader(header: string | undefined): string | null {
  if (!header) return null;
  const m = /sentry_key=([a-f0-9]+)/i.exec(header);
  return m ? m[1].toLowerCase() : null;
}

export function keyFromDsn(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    return url.username ? url.username.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function extractKey(opts: {
  authHeader?: string;
  queryKey?: string;
  envelopeDsn?: string;
}): string | null {
  return (
    keyFromAuthHeader(opts.authHeader) ??
    (opts.queryKey ? opts.queryKey.toLowerCase() : null) ??
    keyFromDsn(opts.envelopeDsn)
  );
}
