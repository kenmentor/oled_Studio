"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { gateway, refreshBalance } from "@/lib/gateway";
import { compact, tokensMoney } from "@/lib/store";
import { Button, Card } from "@/components/ui";

/* Paystack returns here after Checkout: /billing/callback?reference=...
 * (also ?trxref=...). This page only READS the payment status and polls
 * every 3s until the server-side webhook credits the wallet:
 *   pending   → keep polling (webhook in flight, or user hasn't paid)
 *   confirmed → receipt shown, balances refreshed everywhere
 *   failed    → reason shown, nothing credited, support can act
 * The URL alone (and this page) can NEVER credit anything — only the
 * webhook moves money. Refresh-safe: an already-credited reference just
 * reports confirmed again (no double credit, by server design).
 * Localhost note: without webhook forwarding the poll runs out after
 * ~2 min — see the message it shows for the exact CLI command. */
const POLL_MS = 3000;
const POLL_TRIES = 40;

export default function BillingCallbackPage() {
  const [kind, setKind] = useState<"working" | "ok" | "fail">("working");
  const [msg, setMsg] = useState("Confirming your payment — one moment…");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ref = q.get("reference") || q.get("trxref") || "";
    if (!ref) {
      setKind("fail");
      setMsg("No payment reference came back from Paystack — no charge was made.");
      return;
    }
    let alive = true;
    let tries = 0;
    const check = async () => {
      if (!alive) return;
      tries += 1;
      const r = await gateway.paystackVerify(ref);
      if (!alive) return;
      const body = (r.body ?? {}) as {
        status?: string; balance_chars?: number; granted_chars?: number;
        fail_reason?: string; error?: { code?: string; message?: string };
      };
      if (r.ok && body.status === "confirmed") {
        refreshBalance();
        const granted = Number(body.granted_chars ?? 0);
        const bal = Number(body.balance_chars ?? 0);
        setKind("ok");
        setMsg(
          granted > 0
            ? `Wallet funded with ${compact(granted)} tokens. New balance ${tokensMoney(bal)}.`
            : "Payment confirmed by the webhook — wallet already credited."
        );
        return;
      }
      if (r.ok && body.status === "failed") {
        setKind("fail");
        setMsg(
          body.fail_reason
            ? `Payment failed (${body.fail_reason}) — nothing was credited.`
            : "Payment failed — nothing was credited. If you were charged, contact support with your reference."
        );
        return;
      }
      if (tries >= POLL_TRIES) {
        setKind("fail");
        setMsg(
          "Still waiting on the payment confirmation — the webhook may not have reached the server. " +
            "If you paid, your wallet updates automatically; check the wallet page in a minute. " +
            "On localhost, forward webhooks: paystack webhook listen localhost:8000/v1/billing/paystack/webhook"
        );
        return;
      }
      setMsg(`Waiting for the payment confirmation… (${tries * (POLL_MS / 1000)}s)`);
      setTimeout(check, POLL_MS);
    };
    void check();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Payment result</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {kind === "working" ? "waiting on the webhook…" : kind === "ok" ? "confirmed" : "needs attention"}
        </p>
      </header>
      <Card>
        <div className="space-y-4 p-6 sm:p-8">
          <p className={`text-sm ${kind === "fail" ? "text-red-400" : "text-zinc-300"}`}>{msg}</p>
          <Link href="/billing">
            <Button variant={kind === "fail" ? "outline" : undefined}>Back to wallet</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
