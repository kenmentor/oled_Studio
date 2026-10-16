"use client";

import { useEffect, useState } from "react";
import { gateway, refreshBalance } from "@/lib/gateway";
import { compact, money, tokensMoney, useAccount } from "@/lib/store";
import { Badge, Button, Card, CardHead, Input } from "@/components/ui";

interface Txn {
  id: string;
  kind: string;
  status: string;
  amount_kobo: number;
  granted_chars: number;
  label: string;
  created_at: string;
}

/* Status colors for the money feed: green = tokens landed, red = dead
 * (nothing credited, reason in history), neutral = still in flight. */
const TXN_TONE: Record<string, "green" | "red" | "neutral"> = {
  confirmed: "green",
  failed: "red",
  pending: "neutral",
  processing: "neutral",
};

export default function BillingPage() {
  const { account } = useAccount();
  const [serverBalance, setServerBalance] = useState<number | null>(null);
  const [topupNaira, setTopupNaira] = useState("8500");
  const [topupMsg, setTopupMsg] = useState<string | null>(null);
  const [topupBusy, setTopupBusy] = useState(false);
  const [payCfg, setPayCfg] = useState<{ enabled: boolean; test_mode: boolean } | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);

  useEffect(() => {
    const uid = account?.uid ?? "";
    const load = () => {
      void gateway.balance(uid).then((b) => {
        if (b) setServerBalance(b.balance_chars);
      });
      void gateway.transactions().then((r) => {
        if (r) setTxns(r.transactions);
      });
    };
    load();
    void gateway.paystackConfig().then((c) => {
      if (c) setPayCfg(c);
    });
    window.addEventListener("oled-balance", load);
    return () => window.removeEventListener("oled-balance", load);
  }, [account?.uid]);

  if (!account) return null;

  /* Real money, step 1 of 2: the server creates a Paystack Checkout URL
   * and we LEAVE for checkout.paystack.com (card typed there, never here).
   * Step 2 happens on /billing/callback: it polls the server until the
   * WEBHOOK credits the wallet. This button only OPENS checkout — if the
   * user never pays, nothing happens (the attempt stays "pending"). */
  const topUp = () => {
    const naira = Number(topupNaira) || 0;
    if (naira < 1) {
      setTopupMsg("Enter an amount of at least ₦1.");
      return;
    }
    setTopupBusy(true);
    setTopupMsg(null);
    void gateway.paystackInit(Math.round(naira * 100)).then((r) => {
      if (r.ok && r.body?.authorization_url) {
        window.location.href = r.body.authorization_url as string;
        return;
      }
      setTopupBusy(false);
      setTopupMsg(
        r.status === 401
          ? "Session expired — sign in again."
          : r.status === 503
            ? "Payments aren't configured on this server yet."
            : `Couldn't start checkout (${r.status}). Try again.`
      );
    });
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Wallet</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {serverBalance === null
            ? "connecting…"
            : `${tokensMoney(serverBalance)} · ${compact(serverBalance)} tokens`}
        </p>
      </header>

      {/* One idea: the money. */}
      <Card>
        <CardHead title="Balance" />
        <div className="space-y-2 p-6 sm:p-8">
          <p className="tabular break-words font-display text-4xl font-semibold leading-tight">
            {serverBalance === null ? "···" : tokensMoney(serverBalance)}
          </p>
          <p className="text-xs text-zinc-600">
            {serverBalance === null ? "connecting…" : `= ${compact(serverBalance)} tokens · ₦1 buys 1,000`}
          </p>
        </div>
      </Card>

      {/* One idea: funding it. */}
      <Card>
        <CardHead
          title="Fund wallet"
          hint={payCfg && !payCfg.enabled ? "payments not configured" : payCfg?.test_mode ? "Paystack test mode" : undefined}
        />
        <div className="space-y-3 p-6 sm:p-8">
          <div className="grid gap-2.5 sm:grid-cols-[1fr_auto]">
            <Input
              value={topupNaira}
              onChange={(e) => setTopupNaira(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
              placeholder="Amount in NGN"
              aria-label="Top-up amount in NGN"
              inputMode="numeric"
            />
            <Button disabled={topupBusy || !topupNaira || payCfg?.enabled === false} onClick={topUp}>
              {topupBusy ? "Opening checkout…" : "Pay with Paystack"}
            </Button>
          </div>
          {payCfg && !payCfg.enabled && (
            <p className="text-xs text-amber-400">
              The server has no Paystack key yet — set PAYSTACK_SECRET to enable funding.
            </p>
          )}
          {payCfg?.test_mode && (
            <p className="font-mono text-[11px] text-zinc-600">
              Test mode: use card 4084 0840 8408 4081, any future expiry, any CVV.
            </p>
          )}
          {topupNaira && Number(topupNaira) > 0 && (
            <p className="font-mono text-[11px] text-zinc-600">
              ₦{Number(topupNaira).toLocaleString("en-US")} → {compact(Number(topupNaira) * 1000)} tokens
            </p>
          )}
          {topupMsg && <p className="text-xs text-zinc-400">{topupMsg}</p>}
        </div>
      </Card>

      {/* One feed: confirmed top-ups plus pending/failed attempts. */}
      <Card>
        <CardHead
          title="Transaction history"
          hint={txns.length ? `${txns.length} on this account` : undefined}
        />
        {txns.length > 0 ? (
          <ul className="divide-y divide-line">
            {txns.map((t) => (
              <li key={`${t.kind}-${t.id}`} className="flex items-center gap-4 px-5 py-3.5 sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px] text-zinc-500">{t.label}</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {t.status === "confirmed"
                      ? `+${compact(t.granted_chars)} tokens`
                      : t.status === "failed"
                        ? "failed — nothing credited"
                        : "waiting for payment…"}
                  </p>
                </div>
                <Badge tone={TXN_TONE[t.status] ?? "neutral"}>{t.status}</Badge>
                <span className="tabular shrink-0 font-mono text-xs text-zinc-300">
                  {money(t.amount_kobo)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-6 py-10 text-center text-sm text-zinc-600">
            No transactions yet — fund the wallet above and every attempt lands here.
          </p>
        )}
      </Card>
    </div>
  );
}
