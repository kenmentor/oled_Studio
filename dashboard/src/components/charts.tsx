"use client";

/* Charts, hand-rolled in SVG. Three shapes cover this app, and a charting
 * library would cost more bytes than the whole dashboard. */

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * power;
}

export function Bars({
  values,
  labels,
  format,
  formatAxis,
  per,
  onPick,
}: {
  values: number[];
  labels?: string[];
  format?: (v: number) => string;
  formatAxis?: (v: number) => string;
  /** Unit for the average in the caption, e.g. "/hr" for a 24h view. */
  per?: string;
  onPick?: (index: number) => void;
}) {
  const [pinned, setPinned] = useState(values.length - 1);
  const [preview, setPreview] = useState<number | null>(null);
  const barRefs = useRef<Array<SVGGElement | null>>([]);

  const safePinned = Math.min(Math.max(pinned, 0), Math.max(values.length - 1, 0));
  const shown = preview ?? safePinned;
  const selectedValue = values[shown] ?? 0;
  const total = values.reduce((a, b) => a + b, 0);
  const average = values.length ? total / values.length : 0;
  const max = Math.max(0, ...values);
  const ceiling = niceCeiling(max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(ceiling * f));

  const width = 640;
  const height = 230;
  const margin = { top: 16, right: 12, bottom: 34, left: 52 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const slot = values.length ? innerWidth / values.length : innerWidth;
  const barWidth = Math.max(2, Math.min(30, slot * 0.58));
  const tickEvery = Math.max(1, Math.ceil(values.length / 6));
  const axis = (v: number) => (formatAxis ? formatAxis(v) : String(Math.round(v)));
  const describe = (v: number) => (format ? format(v) : String(Math.round(v)));

  const activate = (index: number) => {
    setPinned(index);
    onPick?.(index);
  };

  const move = (from: number, direction: 1 | -1) => {
    if (!values.length) return;
    const next = (from + direction + values.length) % values.length;
    activate(next);
    barRefs.current[next]?.focus();
  };

  return (
    <figure className="min-w-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Usage chart. Total ${describe(total)}. Selected ${labels?.[shown] ?? `bucket ${shown + 1}`}: ${describe(selectedValue)}.`}
        className="block h-auto w-full"
        onMouseLeave={() => setPreview(null)}
      >
        {ticks.map((tick) => {
          const y = margin.top + innerHeight - (tick / ceiling) * innerHeight;
          return (
            <g key={tick}>
              <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} stroke="#232323" strokeWidth={tick === 0 ? 1.5 : 1} />
              <text x={margin.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#71717a" fontFamily="JetBrains Mono, monospace">
                {axis(tick)}
              </text>
            </g>
          );
        })}

        {values.map((v, i) => {
          const heightValue = Math.max(v > 0 ? 4 : 1.5, (v / ceiling) * innerHeight);
          const x = margin.left + i * slot + (slot - barWidth) / 2;
          const y = margin.top + innerHeight - heightValue;
          const selected = i === shown;
          const label = `${labels?.[i] ?? `Day ${i + 1}`}: ${describe(v)}`;

          return (
            <g key={`${labels?.[i] ?? i}-${i}`}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={heightValue}
                rx={3}
                fill={selected ? "#ff5c0a" : "#2b2b2f"}
                className="transition-colors"
              />
              <rect
                ref={(node) => {
                  barRefs.current[i] = node?.parentElement as SVGGElement | null;
                }}
                x={margin.left + i * slot}
                y={margin.top}
                width={slot}
                height={innerHeight}
                fill="transparent"
                tabIndex={i === shown ? 0 : -1}
                role="button"
                aria-label={label}
                className="cursor-pointer outline-none"
                onMouseEnter={() => setPreview(i)}
                onFocus={() => setPreview(i)}
                onBlur={() => setPreview(null)}
                onClick={() => activate(i)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate(i);
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    move(i, 1);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    move(i, -1);
                  }
                }}
              />
              {i % tickEvery === 0 && labels?.[i] && (
                <text
                  x={margin.left + i * slot + slot / 2}
                  y={height - 10}
                  textAnchor="middle"
                  fontSize={11}
                  fill={selected ? "#d4d4d8" : "#52525b"}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <figcaption aria-live="polite" className="mt-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="tabular min-w-0 truncate text-sm font-medium">{describe(selectedValue)}</p>
        <p className="min-w-0 break-words text-right font-mono text-[11px] text-zinc-600">
          {labels?.[shown] ?? `Bucket ${shown + 1}`} · {describe(total)} total · {describe(average)}
          {per ?? "/day"}
        </p>
      </figcaption>
    </figure>
  );
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? 100 / (values.length - 1) : 100;
  const points = values.map((v, i) => `${i * step},${32 - (v / max) * 30}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn("h-8 w-full", className)}>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Ring({
  pct,
  label,
  sub,
}: {
  pct: number;
  label: string;
  sub?: string;
}) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 80 80" className="size-20 shrink-0 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#1c1c1c" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="var(--color-ember)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (clamped / 100) * c}
        />
      </svg>
      <div className="min-w-0">
        <p className="tabular font-display text-xl font-semibold">{label}</p>
        {sub && <p className="mt-0.5 font-mono text-[11px] text-zinc-600">{sub}</p>}
      </div>
    </div>
  );
}

export function Meter({ pct, tone = "ember" }: { pct: number; tone?: "ember" | "gold" }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
      <div
        className={cn("h-full rounded-full", tone === "ember" ? "bg-ember" : "bg-gold")}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}
