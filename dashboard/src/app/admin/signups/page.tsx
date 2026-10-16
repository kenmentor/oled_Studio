"use client";

/* Signups: who joined, who renders, who's dormant, who pays. */

import { compact } from "@/lib/store";
import { Badge, Card, CardHead } from "@/components/ui";
import { AdminPageShell, Stat } from "../_lib";

export default function AdminSignupsPage() {
  return (
    <AdminPageShell title="Signups" sub="Every account, newest first.">
      {(data) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Users" value={compact(data.users.total)} sub={`+${data.users.new_7d} this week`} />
            <Stat label="Activated" value={compact(data.funnel.activated)} sub={`${(data.funnel.signup_to_activated * 100).toFixed(1)}% rendered ≥ once`} />
            <Stat label="Paid" value={compact(data.funnel.paid)} sub={`${(data.funnel.activated_to_paid * 100).toFixed(1)}% of activated`} />
            <Stat label="Dormant" value={compact(data.users.dormant)} sub="signed up, zero renders" />
          </div>

          <Card>
            <CardHead title="Top users · by chars rendered" />
            <ul className="divide-y divide-line">
              {data.users.top.map((u) => (
                <li key={u.email} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{u.email}</p>
                    <p className="font-mono text-[11px] text-zinc-600">{u.renders} renders</p>
                  </div>
                  <Badge tone={u.paid ? "green" : "neutral"}>{u.paid ? "paid" : "free"}</Badge>
                  <span className="tabular shrink-0 font-mono text-[11px] text-zinc-500">{compact(u.chars)}</span>
                </li>
              ))}
              {data.users.top.length === 0 && <li className="px-5 py-6 text-sm text-zinc-600">No renders yet.</li>}
            </ul>
          </Card>

          <Card>
            <CardHead title="Latest signups" />
            <ul className="divide-y divide-line">
              {data.users.recent.map((u) => (
                <li key={u.email} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{u.name || u.email}</p>
                    <p className="truncate font-mono text-[11px] text-zinc-600">{u.email} · {u.created_at.slice(0, 10)}</p>
                  </div>
                  <span className="tabular shrink-0 font-mono text-[11px] text-zinc-500">{compact(u.balance_chars)}</span>
                </li>
              ))}
              {data.users.recent.length === 0 && <li className="px-5 py-6 text-sm text-zinc-600">Nobody yet.</li>}
            </ul>
          </Card>
        </>
      )}
    </AdminPageShell>
  );
}
