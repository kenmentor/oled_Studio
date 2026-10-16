"use client";

/* Admin overview: the simplest direct matrix only. Depth lives in the tabs. */

import { compact, money } from "@/lib/store";
import { Card, CardHead, SectionLabel } from "@/components/ui";
import { AdminPageShell, Stat } from "./_lib";

export default function AdminOverviewPage() {
  return (
    <AdminPageShell title="Overview" sub="The business at a glance. Detail lives in the tabs.">
      {(data) => (
        <>
          {/* money hero: paid in vs sitting in Paystack */}
          <Card className="overflow-hidden">
            <div className="grid gap-0 sm:grid-cols-2">
              <div className="p-6 sm:p-8">
                <SectionLabel>Paid in so far</SectionLabel>
                <p className="tabular mt-3 break-words font-display text-4xl font-semibold leading-tight sm:text-5xl">
                  {money(data.revenue.paid_in_kobo)}
                </p>
                <p className="mt-2 font-mono text-[11px] text-zinc-600">
                  {data.revenue.fulfilled} payments · {data.revenue.pending} pending · {data.revenue.failed} failed · avg {money(data.revenue.avg_topup_kobo)}
                </p>
              </div>
              <div className="border-t border-line bg-surface p-6 sm:border-l sm:border-t-0 sm:p-8">
                <SectionLabel>In Paystack account</SectionLabel>
                <p className="tabular mt-3 break-words font-display text-4xl font-semibold leading-tight sm:text-5xl">
                  {data.revenue.paystack_balance_kobo === null ? "···" : money(data.revenue.paystack_balance_kobo)}
                </p>
                <p className="mt-2 font-mono text-[11px] text-zinc-600">
                  {data.revenue.paystack_balance_kobo === null
                    ? "unreachable — check keys/network"
                    : "live balance, settles to your bank on schedule"}
                </p>
              </div>
            </div>
          </Card>

          {/* funnel: where strangers become paying users */}
          <Card>
            <CardHead title="Funnel" />
            <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
              {[
                { label: "Visits", value: compact(data.funnel.visits), sub: "anonymous hits" },
                { label: "Signups", value: compact(data.funnel.signups), sub: `${(data.funnel.visit_to_signup * 100).toFixed(1)}% of visits` },
                { label: "Activated", value: compact(data.funnel.activated), sub: `${(data.funnel.signup_to_activated * 100).toFixed(1)}% of signups · ≥1 render` },
                { label: "Paid", value: compact(data.funnel.paid), sub: `${(data.funnel.activated_to_paid * 100).toFixed(1)}% of activated · ≥1 payment` },
              ].map((s) => (
                <div key={s.label} className="bg-card p-4">
                  <SectionLabel>{s.label}</SectionLabel>
                  <p className="tabular mt-1.5 font-display text-2xl font-semibold">{s.value}</p>
                  <p className="mt-1 font-mono text-[11px] text-zinc-600">{s.sub}</p>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Users" value={compact(data.users.total)} sub={`+${data.users.new_7d} this week · ${data.users.dormant} dormant`} />
            <Stat label="Rendered (7d)" value={compact(data.renders.chars_7d)} sub={`${data.renders.total} renders all time`} />
            <Stat label="Audio generated" value={`${data.renders.audio_hours}h`} sub={`${compact(data.renders.chars_total)} chars`} />
            <Stat label="Render errors" value={compact(data.renders.quality.errors)} sub={`${(data.renders.quality.error_rate * 100).toFixed(1)}% failure rate`} />
            <Stat label="Logins (7d)" value={compact(data.logins.last_7d)} sub={`${compact(data.logins.total)} all time`} />
            <Stat label="Visits (7d)" value={compact(data.visits.last_7d)} sub={`${compact(data.visits.total)} all time`} />
            <Stat label="Owed to users" value={compact(data.users.liability_chars)} sub="unspent wallet chars" />
            <Stat label="Avg render" value={compact(data.renders.quality.avg_chars)} sub="chars per render" />
          </div>
        </>
      )}
    </AdminPageShell>
  );
}
