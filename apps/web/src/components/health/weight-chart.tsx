"use client";

import * as React from "react";

interface Point {
  takenAt: string;
  weightKg: number;
}

/** A hand-rolled, dependency-free SVG line chart — "gráfico leve" literally: no charting
 * library needed for a couple's weight trend over a few dozen points. Shows the raw series plus
 * a 3-point moving average to smooth day-to-day noise. */
export function WeightChart({ points }: { points: Point[] }) {
  const sorted = [...points].sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime());
  if (sorted.length < 2) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Registre ao menos 2 pesagens para ver a tendência.</div>;
  }

  const width = 600;
  const height = 160;
  const padding = 24;

  const weights = sorted.map((p) => p.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min || 1;

  const x = (i: number) => padding + (i / (sorted.length - 1)) * (width - padding * 2);
  const y = (w: number) => height - padding - ((w - min) / range) * (height - padding * 2);

  const linePath = sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.weightKg)}`).join(" ");

  const movingAvg = sorted.map((_, i) => {
    const windowPts = sorted.slice(Math.max(0, i - 2), i + 1);
    return windowPts.reduce((sum, p) => sum + p.weightKg, 0) / windowPts.length;
  });
  const avgPath = movingAvg.map((w, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(w)}`).join(" ");

  const first = sorted[0].weightKg;
  const last = sorted[sorted.length - 1].weightKg;
  const deltaKg = Math.round((last - first) * 10) / 10;

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
        <path d={avgPath} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.5} />
        <path d={linePath} fill="none" stroke="var(--color-primary)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {sorted.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.weightKg)} r={3} fill="var(--color-primary)" />
        ))}
      </svg>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{min}kg</span>
        <span className={deltaKg > 0 ? "text-warning" : deltaKg < 0 ? "text-success" : ""}>
          {deltaKg > 0 ? "+" : ""}
          {deltaKg}kg no período
        </span>
        <span>{max}kg</span>
      </div>
    </div>
  );
}
