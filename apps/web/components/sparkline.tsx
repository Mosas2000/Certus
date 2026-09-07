"use client";

export function Sparkline({ points, width = 120, height = 32 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) {
    return <svg width={width} height={height} className="sparkline" aria-hidden="true" />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = height - ((p - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = points[points.length - 1];
  const up = last >= points[0];
  return (
    <svg width={width} height={height} className="sparkline" aria-hidden="true">
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={up ? "var(--accent)" : "var(--warn)"}
        strokeWidth="1.5"
      />
    </svg>
  );
}
