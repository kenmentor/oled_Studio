"use client";

/* Admin observability: who signed up, who logs in, who visits, who pays,
 * who renders. Server-gated by ADMIN_EMAILS — a 403 here means either the
 * env var is unset (message says so) or this account isn't an admin. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { gateway } from "@/lib/gateway";
import { compact, money } from "@/lib/store";
import { Badge, Button, Card, CardHead, SectionLabel } from "@/components/ui";
import { Bars } from "@/components/charts";

interface Overview {
  users: { total: number; new_7d: number; recent: { name: string; email: string; created_at: string; balance_chars: number }[] };
  logins: { total: number; last_7d: number; series_14d: { day: string; count: number }[]; recent: { email: string; method: string; at: string }[] };
  visits: { total: number; last_7d: number; series_14d: { day: string; count: number }[]; by_path: { path: string; count: number }[] };
  renders: {
    total: number; chars_total: number; chars_7d: number; audio_hours: number;
    previews: { users: number; renders: number; chars: number };
    by_voice: { voice: string; renders: number; chars: number }[];
    by_mode: { stream: number; batch: number };
    recent: { email: string; chars: number; voice: string; mode: string; status: string; at: string }[];
  };
  revenue: {
    kobo_total: number; paid_in_kobo: number; paystack_balance_kobo: number | null;
    fulfilled: number; pending: number; failed: number;
    recent: { email: string; amount_kobo: number; status: string; reference: string; created_at: string }[];
  };
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="p-4">
      <SectionLabel>{label}</SectionLabel>
      <p className="tabular mt-1.5 break-words font-display text-2xl font-semibold">{value}</p>
      <p className="mt-1 font-mono text-[11px] text-zinc-600">{sub}</p>
    </Card>
  );
}

const dayLabel = (d: string) => d.slice(5);

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void gateway.adminOverview().then((r) => {
      if (!alive) return;
      if (r.ok && r.body) {
        setData(r.body as Overview);
      } else {
        const code = (r.body as { error?: { code?: string } } | null)?.error?.code;
        setDenied(
          code === "admin_not_configured"
            ? "Set ADMIN_EMAILS to your login email on the server, then restart it."
            : "This account is not an admin."
        );
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (denied) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-zinc-500">Restricted area.</p>
        </header>
        <Card>
          <div className="space-y-4 p-6 text-center sm:p-8">
            <p className="text-sm text-zinc-400">{denied}</p>
            <Link href="/overview">
              <Button variant="outline" size="sm">Back to overview</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-zinc-500">loading the numbers…</p>
        </header>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-zinc-500">Signups · logins · visits · renders · revenue.</p>
      </header>

      {/* money hero: paid in vs sitting in Paystack */}
      <Card className="overflow-hidden">
        <div className="grid gap-0 sm:grid-cols-2">
          <div className="p-6 sm:p-8">
            <SectionLabel>Paid in so far</SectionLabel>
            <p className="tabular mt-3 break-words font-display text-4xl font-semibold leading-tight sm:text-5xl">
              {money(data.revenue.paid_in_kobo)}
            </p>
            <p className="mt-2 font-mono text-[11px] text-zinc-600">
              {data.revenue.fulfilled} Paystack payments · {data.revenue.pending} pending · {data.revenue.failed} failed
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={compact(data.users.total)} sub={`+${data.users.new_7d} this week`} />
        <Stat label="Logins (7d)" value={compact(data.logins.last_7d)} sub={`${compact(data.logins.total)} all time`} />
        <Stat label="Visits (7d)" value={compact(data.visits.last_7d)} sub={`${compact(data.visits.total)} all time`} />
        <Stat label="Audio generated" value={`${data.renders.audio_hours}h`} sub={`${compact(data.renders.chars_total)} chars · ${data.renders.by_mode.stream} ws / ${data.renders.by_mode.batch} http`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Free previews" value={compact(data.renders.previews.renders)} sub={`${data.renders.previews.users} people · ${compact(data.renders.previews.chars)} chars · cost ₦0`} />
        <Stat label="Rendered (7d)" value={compact(data.renders.chars_7d)} sub={`${data.renders.total} renders all time`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="Visits · 14 days" />
          <div className="px-4 pb-2">
            <Bars values={data.visits.series_14d.map((p) => p.count)} labels={data.visits.series_14d.map((p) => dayLabel(p.day))} />
          </div>
        </Card>
        <Card>
          <CardHead title="Logins · 14 days" />
          <div className="px-4 pb-2">
            <Bars values={data.logins.series_14d.map((p) => p.count)} labels={data.logins.series_14d.map((p) => dayLabel(p.day))} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Latest signups" />
        <ul className="divide-y divide-line">
          {data.users.recent.map((u) => (
            <li key={u.email} className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{u.name || u.email}</p>
                <p className="truncate font-mono text-[11px] text-zinc-600">{u.email}</p>
              </div>
              <span className="tabular shrink-0 font-mono text-[11px] text-zinc-500">{compact(u.balance_chars)}</span>
            </li>
          ))}
          {data.users.recent.length === 0 && <li className="px-5 py-6 text-sm text-zinc-600">Nobody yet.</li>}
        </ul>
      </Card>

      <Card>
        <CardHead title="Latest payments" />
        <ul className="divide-y divide-line">
          {data.revenue.recent.map((p) => (
            <li key={p.reference} className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] text-zinc-500">{p.reference}</p>
                <p className="truncate text-xs text-zinc-400">{p.email}</p>
              </div>
              <Badge tone={p.status === "fulfilled" ? "green" : p.status === "failed" ? "red" : "neutral"}>{p.status}</Badge>
              <span className="tabular shrink-0 font-mono text-xs text-zinc-300">{money(p.amount_kobo)}</span>
            </li>
          ))}
          {data.revenue.recent.length === 0 && <li className="px-5 py-6 text-sm text-zinc-600">No payment attempts yet.</li>}
        </ul>
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
      </div>

      <Card>
        <CardHead title="Latest renders" />
        <ul className="divide-y divide-line">
          {data.renders.recent.map((r, i) => (
            <li key={`${r.at}-${i}`} className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{r.email} · {r.voice || "—"}</p>
                <p className="font-mono text-[11px] text-zinc-600">{r.mode} · {r.status}</p>
              </div>
              <span className="tabular shrink-0 font-mono text-[11px] text-zinc-500">{compact(r.chars)} chars</span>
            </li>
          ))}
          {data.renders.recent.length === 0 && <li className="px-5 py-6 text-sm text-zinc-600">No renders yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
