"use client";

/* API keys: which secrets actually render. Key names come from usage events,
 * so deleted keys still show their historical share. */

import { compact } from "@/lib/store";
import { Card, CardHead } from "@/components/ui";
import { Bars } from "@/components/charts";
import { AdminPageShell, Stat } from "../_lib";

export default function AdminKeysPage() {
  return (
    <AdminPageShell title="API keys" sub="Render volume per key name.">
      {(data) => {
        const total = Math.max(1, data.renders.top_keys.reduce((n, k) => n + k.renders, 0));
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Active keys" value={compact(data.renders.top_keys.length)} sub="rendered in window" />
              <Stat
                label="Top key share"
                value={data.renders.top_keys.length ? `${Math.round((data.renders.top_keys[0].renders / total) * 100)}%` : "—"}
                sub={data.renders.top_keys.length ? data.renders.top_keys[0].key : "no renders yet"}
              />
            </div>

            <Card>
              <CardHead title="Renders per key" />
              <div className="px-4 pb-2">
                <Bars values={data.renders.top_keys.map((k) => k.renders)} labels={data.renders.top_keys.map((k) => k.key.slice(0, 12))} />
              </div>
            </Card>

            <Card>
              <CardHead title="All keys · by renders" />
              <ul className="divide-y divide-line">
                {data.renders.top_keys.map((k) => (
                  <li key={k.key} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{k.key}</p>
                      <p className="font-mono text-[11px] text-zinc-600">{compact(k.chars)} chars</p>
                    </div>
                    <span className="tabular shrink-0 font-mono text-[11px] text-zinc-500">{k.renders} renders</span>
                  </li>
                ))}
                {data.renders.top_keys.length === 0 && <li className="px-5 py-6 text-sm text-zinc-600">No renders yet.</li>}
              </ul>
            </Card>
          </>
        );
      }}
    </AdminPageShell>
  );
}
