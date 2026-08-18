"use client";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <div className="empty">
      <p>Something went wrong loading this page.</p>
      <button type="button" onClick={reset} style={{ marginTop: 12 }}>
        Try again
      </button>
    </div>
  );
}
