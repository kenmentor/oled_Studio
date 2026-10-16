"use client";

/* Tokens: the wallet liability — chars owed to users. ₦1 = 1,000 tokens,
 * 1 text char costs 1 token. Unspent balances are debt against future renders. */

import { compact, tokensMoney } from "@/lib/store";
import { Card, CardHead } from "@/components/ui";
import { AdminPageShell, Stat } from "../_lib";

export default function AdminTokensPage() {
  return (
    <AdminPageShell title="Tokens" sub="Wallet balances across every account.">
      {(data) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Owed to users" value={compact(data.users.liability_chars)} sub={`≈ ${tokensMoney(data.users.liability_chars)} unspent`} />
            <Stat label="Rendered total" value={compact(data.renders.chars_total)} sub="chars consumed, all time" />
            <Stat label="Rendered (7d)" value={compact(data.renders.chars_7d)} sub="chars consumed this week" />
            <Stat label="Dormant wallets" value={compact(data.users.dormant)} sub="funded but never rendered" />
          </div>

          <Card>
            <CardHead title="Balances · latest signups" />
            <ul className="divide-y divide-line">
              {data.users.recent.map((u) => (
                <li key={u.email} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{u.name || u.email}</p>
                    <p className="truncate font-mono text-[11px] text-zinc-600">{u.email}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular font-mono text-xs text-zinc-300">{compact(u.balance_chars)}</p>
                    <p className="font-mono text-[11px] text-zinc-600">{tokensMoney(u.balance_chars)}</p>
                  </div>
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
