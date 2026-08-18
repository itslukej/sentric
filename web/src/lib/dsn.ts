export function buildDsn(publicKey: string, projectId: number): string {
  const base = process.env.INGEST_PUBLIC_URL ?? "http://localhost:3001";
  const url = new URL(base);
  return `${url.protocol}//${publicKey}@${url.host}/${projectId}`;
}
