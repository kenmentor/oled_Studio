"use client";

/* Standalone admin area: deliberately OUTSIDE the user shell — no sidebar
 * entry, no shortcut, no reference from user pages. Direct URL only, and
 * every byte is server-gated by ADMIN_EMAILS (401/403 here means the
 * session is missing or this account isn't an admin).
 *
 * One fetch feeds every tab: GET /v1/admin/overview is the ONLY route
 * that does cross-user reads. Nothing here computes business numbers
 * from per-user endpoints. */

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { gateway } from "@/lib/gateway";
import { Button, Card, SectionLabel } from "@/components/ui";

export interface Overview {
  users: {
    total: number; new_7d: number; dormant: number; liability_chars: number;
    top: { email: string; renders: number; chars: number; paid: boolean }[];
    recent: { name: string; email: string; created_at: string; balance_chars: number }[];
  };
  logins: {
    total: number; last_7d: number;
    series_14d: { day: string; count: number }[];
    by_method: Record<string, number>;
    recent: { email: string; method: string; at: string }[];
  };
  visits: { total: number; last_7d: number; series_14d: { day: string; count: number }[]; by_path: { path: string; count: number }[] };
  renders: {
    total: number; chars_total: number; chars_7d: number; audio_hours: number;
    previews: { users: number; renders: number; chars: number };
    quality: { done: number; errors: number; error_rate: number; avg_chars: number; avg_latency_ms: number };
    series_14d: { day: string; renders: number; chars: number }[];
    top_keys: { key: string; renders: number; chars: number }[];
    by_voice: { voice: string; renders: number; chars: number }[];
    by_mode: { stream: number; batch: number };
    recent: { email: string; chars: number; voice: string; mode: string; status: string; at: string }[];
  };
  funnel: {
    visits: number; signups: number; activated: number; paid: number;
    visit_to_signup: number; signup_to_activated: number; activated_to_paid: number;
  };
  revenue: {
    kobo_total: number; paid_in_kobo: number; paystack_balance_kobo: number | null;
    fulfilled: number; pending: number; failed: number; avg_topup_kobo: number;
    series_14d: { day: string; kobo: number; count: number }[];
    recent: { email: string; amount_kobo: number; status: string; reference: string; created_at: string }[];
  };
}

export function useAdminOverview(): { data: Overview | null; denied: string | null } {
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
            : code === "login_required" || r.status === 401
              ? "Sign in first — this area needs an admin session."
              : "This account is not an admin."
        );
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  return { data, denied };
}

export function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="p-4">
      <SectionLabel>{label}</SectionLabel>
      <p className="tabular mt-1.5 break-words font-display text-2xl font-semibold">{value}</p>
      <p className="mt-1 font-mono text-[11px] text-zinc-600">{sub}</p>
    </Card>
  );
}

export function AdminDenied({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-zinc-500">Restricted area.</p>
      </header>
      <Card>
        <div className="space-y-4 p-6 text-center sm:p-8">
          <p className="text-sm text-zinc-400">{message}</p>
          <Link href="/overview">
            <Button variant="outline" size="sm">Back to app</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

export function AdminLoading({ hint }: { hint: string }) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-zinc-500">{hint}</p>
      </header>
    </div>
  );
}

export function AdminPageShell({ title, sub, children }: { title: string; sub: string; children: (data: Overview) => ReactNode }) {
  const { data, denied } = useAdminOverview();
  if (denied) return <AdminDenied message={denied} />;
  if (!data) return <AdminLoading hint="loading the numbers…" />;
  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500">{sub}</p>
      </header>
      {children(data)}
    </div>
  );
}

export const dayLabel = (d: string) => d.slice(5);
