"use client";

/* Revenue: what customers paid, what's sitting in Paystack, every attempt. */

import { money } from "@/lib/store";
import { Badge, Card, CardHead } from "@/components/ui";
import { Bars } from "@/components/charts";
import { AdminPageShell, Stat, dayLabel } from "../_lib";

export default function AdminRevenuePage() {
  return (
    <AdminPageShell title="Revenue" sub="Paystack-fulfilled money only — demo top-ups never count here.">
      {(data) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Paid in" value={money(data.revenue.paid_in_kobo)} sub={`${data.revenue.fulfilled} fulfilled`} />
            <Stat label="In Paystack" value={data.revenue.paystack_balance_kobo === null ? "···" : money(data.revenue.paystack_balance_kobo)} sub="settles to bank on schedule" />
            <Stat label="Avg top-up" value={money(data.revenue.avg_topup_kobo)} sub="per fulfilled payment" />
            <Stat label="Pending / failed" value={`${data.revenue.pending} / ${data.revenue.failed}`} sub="watch pending age below" />
          </div>

          <Card>
            <CardHead title="Paid in · 14 days" />
            <div className="px-4 pb-2">
              <Bars values={data.revenue.series_14d.map((p) => p.kobo)} labels={data.revenue.series_14d.map((p) => dayLabel(p.day))} />
            </div>
          </Card>

          <Card>
            <CardHead title="Latest payments" />
            <ul className="divide-y divide-line">
              {data.revenue.recent.map((p) => (
                <li key={p.reference} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] text-zinc-500">{p.reference}</p>
                    <p className="truncate text-xs text-zinc-400">{p.email} · {p.created_at.slice(0, 10)}</p>
                  </div>
                  <Badge tone={p.status === "fulfilled" ? "green" : p.status === "failed" ? "red" : "neutral"}>{p.status}</Badge>
                  <span className="tabular shrink-0 font-mono text-xs text-zinc-300">{money(p.amount_kobo)}</span>
                </li>
              ))}
              {data.revenue.recent.length === 0 && <li className="px-5 py-6 text-sm text-zinc-600">No payment attempts yet.</li>}
            </ul>
          </Card>
        </>
      )}
    </AdminPageShell>
  );
}
