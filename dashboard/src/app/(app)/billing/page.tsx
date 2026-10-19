"use client";

import { useEffect, useState } from "react";
import { gateway, refreshBalance } from "@/lib/gateway";
import { compact, money, tokensMoney, useAccount } from "@/lib/store";
import { Badge, Button, Card, CardHead, Input, Modal } from "@/components/ui";

interface Txn {
  id: string;
  kind: string;
  status: string;
  amount_kobo: number;
  granted_chars: number;
  label: string;
  created_at: string;
}

const PRESETS = [500, 1000, 2500, 5000, 8500, 20000];
const MAX_NAIRA = 100_000; // server caps at 10M kobo

/* Fund amount picker: preset chips + big centered display + on-screen
 * number pad. Physical keyboards work too — the display IS a real input,
 * digits only. Confirm leaves for Paystack Checkout (card typed there). */
function FundModal({
  open,
  onClose,
  amount,
  setAmount,
  busy,
  msg,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  amount: string;
  setAmount: (v: string) => void;
  busy: boolean;
  msg: string | null;
  onConfirm: () => void;
}) {
  const pushDigit = (d: string) => {
    setAmount((amount + d).replace(/^\D+/, "").replace(/[^\d]/g, "").slice(0, 7));
  };
  const backspace = () => setAmount(amount.slice(0, -1));
  const naira = Number(amount) || 0;

  return (
    <Modal open={open} onClose={onClose} title="Fund wallet">
      <div className="space-y-5 p-6 sm:p-8">
        {/* presets */}
        <div className="flex flex-wrap justify-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setAmount(String(p))}
              className={`rounded-full border px-4 py-1.5 font-mono text-xs transition-colors ${
                amount === String(p)
                  ? "border-ember bg-ember/10 text-ember"
                  : "border-line text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              }`}
            >
              ₦{p.toLocaleString("en-US")}
            </button>
          ))}
        </div>

        {/* big centered display — a real input, so keyboards just work */}
        <div className="text-center">
          <div className="mx-auto flex max-w-xs items-baseline justify-center gap-1">
            <span className="font-display text-3xl font-semibold text-zinc-500">₦</span>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
              onKeyDown={(e) => e.key === "Enter" && onConfirm()}
              placeholder="0"
              aria-label="Top-up amount in NGN"
              inputMode="numeric"
              autoFocus
              className="h-16 border-0 bg-transparent text-center font-display text-5xl font-bold tabular focus:border-0"
            />
          </div>
          <p className="mt-1 font-mono text-[11px] text-zinc-600">
            {naira > 0 ? `→ ${compact(naira * 1000)} tokens` : "₦1 buys 1,000 tokens"}
          </p>
        </div>

        {/* number pad */}
        <div className="mx-auto grid max-w-xs grid-cols-3 gap-2" role="group" aria-label="Number pad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              onClick={() => pushDigit(d)}
              className="rounded-lg border border-line bg-surface-2 py-3 font-display text-xl font-semibold text-zinc-200 transition-colors hover:border-zinc-600 active:bg-surface"
            >
              {d}
            </button>
          ))}
          <button
            onClick={() => pushDigit("00")}
            className="rounded-lg border border-line bg-surface-2 py-3 font-mono text-sm text-zinc-400 transition-colors hover:border-zinc-600 active:bg-surface"
          >
            00
          </button>
          <button
            onClick={() => pushDigit("0")}
            className="rounded-lg border border-line bg-surface-2 py-3 font-display text-xl font-semibold text-zinc-200 transition-colors hover:border-zinc-600 active:bg-surface"
          >
            0
          </button>
          <button
            onClick={backspace}
            aria-label="Delete last digit"
            className="rounded-lg border border-line bg-surface-2 py-3 text-lg text-zinc-400 transition-colors hover:border-zinc-600 active:bg-surface"
          >
            ⌫
          </button>
        </div>

        {msg && <p className="text-center text-xs text-zinc-400">{msg}</p>}
        <Button className="w-full" disabled={busy || naira < 1} onClick={onConfirm}>
          {busy ? "Opening checkout…" : naira >= 1 ? `Pay ₦${naira.toLocaleString("en-US")}` : "Enter an amount"}
        </Button>
      </div>
    </Modal>
  );
}
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
  const [fundOpen, setFundOpen] = useState(false);
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
    if (naira > MAX_NAIRA) {
      setTopupMsg(`₦${MAX_NAIRA.toLocaleString("en-US")} is the most Paystack takes in one charge — split it in two.`);
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

      {/* One idea: funding it — amount picked in the modal. */}
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
            <div className="flex gap-2">
              <Button variant="outline" disabled={topupBusy} onClick={() => { setTopupMsg(null); setFundOpen(true); }}>
                Add money
              </Button>
              <Button disabled={topupBusy || !topupNaira || payCfg?.enabled === false} onClick={topUp}>
                {topupBusy ? "Opening checkout…" : "Pay with Paystack"}
              </Button>
            </div>
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
      <FundModal
        open={fundOpen}
        onClose={() => !topupBusy && setFundOpen(false)}
        amount={topupNaira}
        setAmount={setTopupNaira}
        busy={topupBusy}
        msg={topupMsg}
        onConfirm={topUp}
      />

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
