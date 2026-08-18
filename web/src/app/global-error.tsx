"use client";

// Last-resort boundary for errors thrown in the root layout itself.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", padding: 40 }}>
        <h1>Sentric</h1>
        <p>Something went wrong.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </body>
    </html>
  );
}
