// Inline SVG bar chart of hourly event counts. Server-rendered, no client JS.
export function Sparkline({
  buckets,
  width = 90,
  height = 22,
  title,
}: {
  buckets: number[];
  width?: number;
  height?: number;
  title?: string;
}) {
  const max = Math.max(1, ...buckets);
  const gap = 1;
  const barWidth = buckets.length > 0 ? width / buckets.length : width;

  return (
    <svg
      className="spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title ?? `${buckets.reduce((a, b) => a + b, 0)} events over the last ${buckets.length} hours`}
    >
      {buckets.map((v, i) => {
        // Always show a sliver for non-zero hours so single events stay visible.
        const h = v === 0 ? 0 : Math.max(2, Math.round((v / max) * height));
        return (
          <rect
            key={i}
            x={i * barWidth}
            y={height - h}
            width={Math.max(1, barWidth - gap)}
            height={h}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

// Bucket event timestamps into the last `hours` hourly slots, oldest first.
export function bucketByHour(
  rows: { hour: number; count: number }[],
  hours = 24
): number[] {
  const nowHour = Math.floor(Date.now() / 3_600_000);
  const buckets = new Array(hours).fill(0);
  for (const { hour, count } of rows) {
    const idx = hours - 1 - (nowHour - hour);
    if (idx >= 0 && idx < hours) buckets[idx] = count;
  }
  return buckets;
}
