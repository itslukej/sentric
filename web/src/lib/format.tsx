export function timeAgo(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toISOString().slice(0, 10);
}

// Relative time with the absolute timestamp on hover (relative text is frozen
// at render, so the ISO tooltip gives precision without any client JS).
export function TimeAgo({ date }: { date: Date }) {
  return <time dateTime={date.toISOString()} title={date.toISOString()}>{timeAgo(date)}</time>;
}

// Event `level` is attacker-controlled, so whitelist it before it reaches a
// className or badge — otherwise an event with level "resolved" could style an
// open issue as resolved.
const LEVELS = new Set(["fatal", "error", "warning", "info", "debug"]);
export function safeLevel(level: string): string {
  return LEVELS.has(level) ? level : "error";
}
