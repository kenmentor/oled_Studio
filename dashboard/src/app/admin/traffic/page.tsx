"use client";

/* Traffic: anonymous visits + top pages. No identity, path only. */

import { compact } from "@/lib/store";
import { Card, CardHead } from "@/components/ui";
import { Bars } from "@/components/charts";
import { AdminPageShell, Stat, dayLabel } from "../_lib";

export default function AdminTrafficPage() {
  return (
    <AdminPageShell title="Traffic" sub="Page-view beacons, anonymous by design.">
      {(data) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Visits" value={compact(data.visits.total)} sub={`${compact(data.visits.last_7d)} last 7d`} />
            <Stat
              label="Visit → signup"
              value={`${(data.funnel.visit_to_signup * 100).toFixed(1)}%`}
              sub={`${compact(data.funnel.signups)} signups from ${compact(data.funnel.visits)} visits`}
            />
          </div>

          <Card>
            <CardHead title="Visits · 14 days" />
            <div className="px-4 pb-2">
              <Bars values={data.visits.series_14d.map((p) => p.count)} labels={data.visits.series_14d.map((p) => dayLabel(p.day))} />
            </div>
          </Card>

          <Card>
            <CardHead title="Top pages" />
            <ul className="divide-y divide-line">
              {data.visits.by_path.map((p) => (
                <li key={p.path} className="flex items-center gap-4 px-5 py-3.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">{p.path}</span>
                  <span className="tabular shrink-0 font-mono text-[11px] text-zinc-500">{compact(p.count)}</span>
                </li>
              ))}
              {data.visits.by_path.length === 0 && <li className="px-5 py-6 text-sm text-zinc-600">No visits tracked yet.</li>}
            </ul>
          </Card>
        </>
      )}
    </AdminPageShell>
  );
}
