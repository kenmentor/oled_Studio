"use client";

/* Logins: session starts by method (github, email signup/signin).
 * Note: logouts aren't tracked — logout only clears the session. */

import { compact, timeAgo } from "@/lib/store";
import { Card, CardHead } from "@/components/ui";
import { Bars } from "@/components/charts";
import { AdminPageShell, Stat, dayLabel } from "../_lib";

export default function AdminLoginsPage() {
  return (
    <AdminPageShell title="Logins" sub="Session starts by method. Email signups count as first login.">
      {(data) => {
        const methods = Object.entries(data.logins.by_method ?? {}).sort((a, b) => b[1] - a[1]);
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Logins" value={compact(data.logins.total)} sub={`${compact(data.logins.last_7d)} last 7d`} />
              {methods.map(([m, n]) => (
                <Stat key={m} label={m} value={compact(n)} sub="sessions started" />
              ))}
            </div>

            <Card>
              <CardHead title="Logins · 14 days" />
              <div className="px-4 pb-2">
                <Bars values={data.logins.series_14d.map((p) => p.count)} labels={data.logins.series_14d.map((p) => dayLabel(p.day))} />
              </div>
            </Card>

            <Card>
              <CardHead title="Latest logins" />
              <ul className="divide-y divide-line">
                {data.logins.recent.map((l, i) => (
                  <li key={`${l.at}-${i}`} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{l.email}</p>
                      <p className="font-mono text-[11px] text-zinc-600">{l.method || "unknown"}</p>
                    </div>
                    <span className="tabular shrink-0 font-mono text-[11px] text-zinc-500">{timeAgo(Date.parse(l.at) || Date.now())}</span>
                  </li>
                ))}
                {data.logins.recent.length === 0 && <li className="px-5 py-6 text-sm text-zinc-600">No logins yet.</li>}
              </ul>
            </Card>
          </>
        );
      }}
    </AdminPageShell>
  );
}
