"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { gateway, refreshBalance } from "@/lib/gateway";
import { compact, money, tokensMoney } from "@/lib/store";
import { Button, Card } from "@/components/ui";

/* Paystack returns here after Checkout: /billing/callback?reference=...
 * (also ?trxref=...). This page only READS the payment status and polls
 * every 3s until the server-side webhook credits the wallet:
 *   pending   → keep polling (webhook in flight, or user hasn't paid)
 *   confirmed → confetti + receipt, balances refreshed everywhere
 *   failed    → reason shown, nothing credited, support can act
 * The URL alone (and this page) can NEVER credit anything — only the
 * webhook moves money. Refresh-safe: an already-credited reference just
 * reports confirmed again (no double credit, by server design).
 * Localhost note: without webhook forwarding the poll runs out after
 * ~2 min — see the message it shows for the exact CLI command. */
const POLL_MS = 3000;
const POLL_TRIES = 40;

interface Receipt {
  reference: string;
  granted: number;
  balance: number;
  amountKobo: number;
  invoiceNumber: string;
}

/* Confetti burst: canvas fixed overlay, ~130 particles, ~2.8s, then gone.
 * No deps, no layout impact, skipped for reduced-motion users. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    const colors = ["#ff5c1f", "#ffd166", "#7CFC98", "#7dd3fc", "#f0abfc", "#ffffff"];
    const parts = Array.from({ length: 130 }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 220,
      y: window.innerHeight * 0.32,
      vx: (Math.random() - 0.5) * 13,
      vy: -Math.random() * 11 - 3,
      s: Math.random() * 7 + 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let alive = true;
    const t0 = performance.now();
    const tick = (t: number) => {
      if (!alive) return;
      const el = (t - t0) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      for (const p of parts) {
        p.vy += 0.32;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.globalAlpha = Math.max(0, 1 - el / 2.8);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      }
      ctx.restore();
      if (el < 2.8) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    requestAnimationFrame(tick);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
    />
  );
}

/* Waiting game: tap the ember dot — it jumps on every hit. Purely local,
 * unmounted the moment the payment resolves. Best score persists per browser. */
const BEST_KEY = "oled.callback.tapbest";

function TapGame() {
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [pos, setPos] = useState({ x: 50, y: 50 });

  useEffect(() => {
    try {
      setBest(Number(localStorage.getItem(BEST_KEY) ?? 0) || 0);
    } catch {
      /* private mode: play without records */
    }
  }, []);

  const tap = useCallback(() => {
    setPos({ x: 8 + Math.random() * 84, y: 12 + Math.random() * 76 });
    setScore((s) => {
      const n = s + 1;
      setBest((b) => {
        if (n > b) {
          try {
            localStorage.setItem(BEST_KEY, String(n));
          } catch {
            /* ignore */
          }
          return n;
        }
        return b;
      });
      return n;
    });
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600">
          while you wait · tap the ember
        </p>
        <p className="tabular font-mono text-[11px] text-zinc-400">
          {score} · best {Math.max(best, score)}
        </p>
      </div>
      <div className="relative h-44 overflow-hidden rounded-md border border-line bg-void">
        <button
          onClick={tap}
          aria-label="Tap the ember dot"
          className="absolute size-10 rounded-full bg-ember shadow-[0_0_24px_4px_rgba(255,92,31,0.55)] transition-all duration-150 hover:scale-110 active:scale-95"
          style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -50%)" }}
        />
      </div>
    </div>
  );
}

/* Pulsing equalizer: pure CSS motion while the webhook is in flight. */
function WaitingBars() {
  return (
    <div className="flex h-10 items-end gap-1.5" aria-hidden>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <span
          key={i}
          className="w-2 animate-pulse rounded-sm bg-ember/70"
          style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${i * 130}ms`, animationDuration: "900ms" }}
        />
      ))}
    </div>
  );
}

export default function BillingCallbackPage() {
  const [kind, setKind] = useState<"working" | "ok" | "fail">("working");
  const [msg, setMsg] = useState("Confirming your payment — one moment…");
  const [tries, setTries] = useState(0);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [reference, setReference] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ref = q.get("reference") || q.get("trxref") || "";
    if (!ref) {
      setKind("fail");
      setMsg("No payment reference came back from Paystack — no charge was made.");
      return;
    }
    setReference(ref);
    let alive = true;
    let n = 0;
    const check = async () => {
      if (!alive) return;
      n += 1;
      setTries(n);
      const r = await gateway.paystackVerify(ref);
      if (!alive) return;
      const body = (r.body ?? {}) as {
        status?: string; balance_chars?: number; granted_chars?: number;
        fail_reason?: string; invoice?: { amount_kobo?: number; number?: string };
        error?: { code?: string; message?: string };
      };
      if (r.ok && body.status === "confirmed") {
        refreshBalance();
        const granted = Number(body.granted_chars ?? 0);
        const bal = Number(body.balance_chars ?? 0);
        setReceipt({
          reference: ref,
          granted,
          balance: bal,
          amountKobo: Number(body.invoice?.amount_kobo ?? 0),
          invoiceNumber: String(body.invoice?.number ?? ""),
        });
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
      if (n >= POLL_TRIES) {
        setKind("fail");
        setMsg(
          "Still waiting on the payment confirmation — the webhook may not have reached the server. " +
            "If you paid, your wallet updates automatically; check the wallet page in a minute. " +
            "On localhost, forward webhooks: paystack webhook listen localhost:8000/v1/billing/paystack/webhook"
        );
        return;
      }
      setMsg(`Waiting for the payment confirmation… (${n * (POLL_MS / 1000)}s)`);
      setTimeout(check, POLL_MS);
    };
    void check();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      {kind === "ok" && <Confetti />}
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Payment result</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {kind === "working" ? "waiting on the webhook…" : kind === "ok" ? "confirmed" : "needs attention"}
        </p>
      </header>

      {kind === "working" && (
        <Card>
          <div className="space-y-5 p-6 sm:p-8">
            <WaitingBars />
            {/* progress through the ~2 min poll window */}
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-ember transition-all duration-500"
                style={{ width: `${Math.min(100, (tries / POLL_TRIES) * 100)}%` }}
              />
            </div>
            <p className="text-sm text-zinc-300">{msg}</p>
            {reference && (
              <p className="truncate font-mono text-[11px] text-zinc-600">ref {reference}</p>
            )}
            <TapGame />
          </div>
        </Card>
      )}

      {kind === "ok" && receipt && (
        <Card>
          <div className="space-y-5 p-6 text-center sm:p-8">
            <p className="font-display text-5xl font-bold tabular break-words text-emerald-400">
              {receipt.amountKobo > 0 ? money(receipt.amountKobo) : tokensMoney(receipt.granted)}
            </p>
            <p className="text-sm text-zinc-300">{msg}</p>
            <div className="mx-auto grid max-w-sm gap-2 text-left font-mono text-[11px] text-zinc-500">
              {receipt.invoiceNumber && (
                <p className="flex justify-between gap-4"><span>invoice</span><span className="text-zinc-300">{receipt.invoiceNumber}</span></p>
              )}
              <p className="flex justify-between gap-4"><span>reference</span><span className="truncate text-zinc-300">{receipt.reference}</span></p>
              <p className="flex justify-between gap-4"><span>new balance</span><span className="text-zinc-300">{compact(receipt.balance)} tokens</span></p>
            </div>
            <div className="flex justify-center gap-2">
              <Link href="/billing">
                <Button>Back to wallet</Button>
              </Link>
              <Link href="/studio">
                <Button variant="outline">Open studio</Button>
              </Link>
            </div>
          </div>
        </Card>
      )}

      {kind === "fail" && (
        <Card>
          <div className="space-y-4 p-6 sm:p-8">
            <p className="text-sm text-red-400">{msg}</p>
            {reference && (
              <p className="truncate font-mono text-[11px] text-zinc-600">ref {reference} · quote it to support</p>
            )}
            <Link href="/billing">
              <Button variant="outline">Back to wallet</Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
