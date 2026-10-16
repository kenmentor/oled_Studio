"use client";

/* Usage: every render — volume, quality, voices, modes, keys, recents. */

import { compact } from "@/lib/store";
import { Badge, Card, CardHead } from "@/components/ui";
import { Bars } from "@/components/charts";
import { AdminPageShell, Stat, dayLabel } from "../_lib";

export default function AdminUsagePage() {
  return (
    <AdminPageShell title="Usage" sub="Every TTS call across all wallets.">
      {(data) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Renders" value={compact(data.renders.total)} sub={`${compact(data.renders.chars_total)} chars`} />
            <Stat label="Rendered (7d)" value={compact(data.renders.chars_7d)} sub="chars this week" />
            <Stat label="Audio" value={`${data.renders.audio_hours}h`} sub="generated, all time" />
            <Stat label="Avg render" value={compact(data.renders.quality.avg_chars)} sub="chars per render" />
            <Stat label="Failures" value={compact(data.renders.quality.errors)} sub={`${(data.renders.quality.error_rate * 100).toFixed(1)}% of renders`} />
            <Stat label="Avg latency" value={`${compact(data.renders.quality.avg_latency_ms)}ms`} sub="to first audio" />
            <Stat label="Stream / batch" value={`${data.renders.by_mode.stream} / ${data.renders.by_mode.batch}`} sub="ws vs http renders" />
            <Stat label="Free previews" value={compact(data.renders.previews.renders)} sub={`${data.renders.previews.users} people · cost ₦0`} />
          </div>

          <Card>
            <CardHead title="Renders · 14 days" />
            <div className="px-4 pb-2">
              <Bars values={data.renders.series_14d.map((p) => p.renders)} labels={data.renders.series_14d.map((p) => dayLabel(p.day))} />
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHead title="Top voices" />
              <ul className="divide-y divide-line">
                {data.renders.by_voice.map((v) => (
                  <li key={v.voice} className="flex items-center gap-4 px-5 py-3.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{v.voice}</span>
                    <span className="tabular shrink-0 font-mono text-[11px] text-zinc-500">{v.renders} renders · {compact(v.chars)}</span>
                  </li>
                ))}
                {data.renders.by_voice.length === 0 && <li className="px-5 py-6 text-sm text-zinc-600">No renders yet.</li>}
              </ul>
            </Card>
            <Card>
              <CardHead title="Latest renders" />
              <ul className="divide-y divide-line">
                {data.renders.recent.map((r, i) => (
                  <li key={`${r.at}-${i}`} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{r.email} · {r.voice || "—"}</p>
                      <p className="font-mono text-[11px] text-zinc-600">{r.mode} · {r.status}</p>
                    </div>
                    <Badge tone={r.status === "done" ? "green" : "red"}>{r.mode}</Badge>
                    <span className="tabular shrink-0 font-mono text-[11px] text-zinc-500">{compact(r.chars)}</span>
                  </li>
                ))}
                {data.renders.recent.length === 0 && <li className="px-5 py-6 text-sm text-zinc-600">No renders yet.</li>}
              </ul>
            </Card>
          </div>
        </>
      )}
    </AdminPageShell>
  );
}
