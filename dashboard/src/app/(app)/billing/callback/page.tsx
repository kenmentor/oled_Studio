"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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

/* Snake: the classic time-killer while the webhook is in flight. Canvas,
 * arrows/WASD, swipe on touch, on-screen pad as fallback. Purely local,
 * unmounted the moment the payment resolves. Best score persists. */
const SNAKE_BEST_KEY = "oled.callback.snakebest";
const COLS = 17;
const ROWS = 17;
const TICK_MS = 140;

type Pt = { x: number; y: number };

function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [dead, setDead] = useState(false);
  const dirRef = useRef<Pt>({ x: 1, y: 0 });
  const queueRef = useRef<Pt[]>([]);
  const stateRef = useRef<{ snake: Pt[]; food: Pt } | null>(null);
  const deadRef = useRef(false);
  const scoreRef = useRef(0);

  useEffect(() => {
    try {
      setBest(Number(localStorage.getItem(SNAKE_BEST_KEY) ?? 0) || 0);
    } catch {
      /* private mode: play without records */
    }
    const spawn = (snake: Pt[]): Pt => {
      for (;;) {
        const p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
        if (!snake.some((s) => s.x === p.x && s.y === p.y)) return p;
      }
    };
    const reset = () => {
      const snake = [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }];
      stateRef.current = { snake, food: spawn(snake) };
      dirRef.current = { x: 1, y: 0 };
      queueRef.current = [];
      scoreRef.current = 0;
      deadRef.current = false;
      setScore(0);
      setDead(false);
    };
    reset();

    const steer = (x: number, y: number) => {
      const last = queueRef.current[queueRef.current.length - 1] ?? dirRef.current;
      if ((x !== -last.x || y !== -last.y) && (x !== last.x || y !== last.y)) {
        if (queueRef.current.length < 3) queueRef.current.push({ x, y });
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "w"].includes(k)) steer(0, -1);
      else if (["arrowdown", "s"].includes(k)) steer(0, 1);
      else if (["arrowleft", "a"].includes(k)) steer(-1, 0);
      else if (["arrowright", "d"].includes(k)) steer(1, 0);
      else return;
      e.preventDefault();
    };
    let touch: Pt | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touch) return;
      const dx = e.touches[0].clientX - touch.x;
      const dy = e.touches[0].clientY - touch.y;
      if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
      steer(Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0, Math.abs(dx) > Math.abs(dy) ? 0 : Math.sign(dy));
      touch = null;
    };
    window.addEventListener("keydown", onKey);
    const wrap = wrapRef.current;
    wrap?.addEventListener("touchstart", onTouchStart, { passive: true });
    wrap?.addEventListener("touchmove", onTouchMove, { passive: true });

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    let alive = true;
    let last = performance.now();
    let acc = 0;
    let deadAt = 0;
    const frame = (t: number) => {
      if (!alive || !canvas || !ctx) return;
      acc += t - last;
      last = t;
      const st = stateRef.current;
      if (st && !deadRef.current && acc >= TICK_MS) {
        acc = 0;
        const q = queueRef.current;
        if (q.length) dirRef.current = q.shift()!;
        const head = { x: st.snake[0].x + dirRef.current.x, y: st.snake[0].y + dirRef.current.y };
        const hitsWall = head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS;
        const hitsSelf = st.snake.some((s, i) => i < st.snake.length - 1 && s.x === head.x && s.y === head.y);
        if (hitsWall || hitsSelf) {
          deadAt = t;
          deadRef.current = true;
          setDead(true);
          setBest((b) => {
            if (scoreRef.current > b) {
              try {
                localStorage.setItem(SNAKE_BEST_KEY, String(scoreRef.current));
              } catch {
                /* ignore */
              }
              return scoreRef.current;
            }
            return b;
          });
        } else {
          st.snake.unshift(head);
          if (head.x === st.food.x && head.y === st.food.y) {
            scoreRef.current += 1;
            setScore(scoreRef.current);
            st.food = spawn(st.snake);
          } else {
            st.snake.pop();
          }
        }
      }
      if (deadRef.current && t - deadAt > 1400) reset();

      // draw
      const w = canvas.clientWidth;
      const cell = w / COLS;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.floor(w * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(w * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, w);
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, w, w);
      if (stateRef.current) {
        const s = stateRef.current;
        ctx.fillStyle = "#ff5c1f";
        ctx.beginPath();
        ctx.arc((s.food.x + 0.5) * cell, (s.food.y + 0.5) * cell, cell * 0.32, 0, Math.PI * 2);
        ctx.fill();
        s.snake.forEach((p, i) => {
          ctx.fillStyle = i === 0 ? "#7CFC98" : `rgba(124, 252, 152, ${Math.max(0.25, 0.9 - i * 0.05)})`;
          ctx.fillRect(p.x * cell + 1, p.y * cell + 1, cell - 2, cell - 2);
        });
      }
      if (deadRef.current) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, w, w);
        ctx.fillStyle = "#fafafa";
        ctx.font = "600 15px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("crashed — restarting…", w / 2, w / 2);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
      wrap?.removeEventListener("touchstart", onTouchStart);
      wrap?.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const pad = (x: number, y: number, label: string) => (
    <button
      onClick={() => {
        const last = queueRef.current[queueRef.current.length - 1] ?? dirRef.current;
        if ((x !== -last.x || y !== -last.y) && (x !== last.x || y !== last.y) && queueRef.current.length < 3) {
          queueRef.current.push({ x, y });
        }
      }}
      aria-label={label}
      className="flex size-11 items-center justify-center rounded-lg border border-line bg-surface-2 text-zinc-300 transition-colors active:bg-surface"
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600">
          while you wait · snake
        </p>
        <p className="tabular font-mono text-[11px] text-zinc-400">
          {score} · best {Math.max(best, score)}
        </p>
      </div>
      <div ref={wrapRef} className="overflow-hidden rounded-md border border-line">
        <canvas ref={canvasRef} className="block aspect-square w-full" />
      </div>
      <div className="flex items-center justify-center gap-2 pt-1 sm:hidden">
        <div className="grid grid-cols-3 gap-1.5">
          <span />
          {pad(0, -1, "↑")}
          <span />
          {pad(-1, 0, "←")}
          {pad(0, 1, "↓")}
          {pad(1, 0, "→")}
        </div>
      </div>
      <p className="hidden text-center font-mono text-[11px] text-zinc-600 sm:block">
        arrows / WASD to steer · swipe on touch
      </p>
    </div>
  );
}

function fmtElapsed(sec: number) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, "0")}`;
}

/* Where the money is right now: step 1 done (they left for Paystack),
 * steps 2–3 still thinking. Honest about what we know — verify only
 * reports pending until the webhook lands. */
function PendingSteps({ elapsed }: { elapsed: number }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <span className="tabular font-display text-4xl font-semibold text-zinc-100">{fmtElapsed(elapsed)}</span>
        <div className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">thinking…</p>
          <p className="text-xs text-zinc-600">polling the webhook every 3s — leave this page open</p>
        </div>
      </div>
      <ol className="space-y-2.5 border-t border-line pt-4">
        {[
          { label: "Checkout opened", sub: "you left for Paystack", state: "done" as const },
          { label: "Bank confirms payment", sub: "Paystack tells our server", state: "active" as const },
          { label: "Wallet credited", sub: "tokens land, confetti pops", state: "todo" as const },
        ].map((s) => (
          <li key={s.label} className="flex items-center gap-3">
            <span
              aria-hidden
              className={
                s.state === "done"
                  ? "flex size-5 items-center justify-center rounded-full bg-emerald-500/20 font-mono text-[10px] text-emerald-400"
                  : s.state === "active"
                    ? "size-5 animate-spin rounded-full border-2 border-line border-t-ember"
                    : "size-5 rounded-full border border-line"
              }
            >
              {s.state === "done" ? "✓" : ""}
            </span>
            <div className="min-w-0">
              <p className={`text-sm ${s.state === "todo" ? "text-zinc-600" : "text-zinc-200"}`}>{s.label}</p>
              <p className="font-mono text-[11px] text-zinc-600">{s.sub}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function BillingCallbackPage() {
  const [kind, setKind] = useState<"working" | "ok" | "fail">("working");
  const [msg, setMsg] = useState("Confirming your payment — one moment…");
  const [tries, setTries] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [reference, setReference] = useState("");

  useEffect(() => {
    const started = Date.now();
    const clock = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(clock);
  }, []);

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
            <PendingSteps elapsed={elapsed} />
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
            <SnakeGame />
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
          <div className="space-y-5 p-6 text-center sm:p-8">
            <p aria-hidden className="mx-auto flex size-14 items-center justify-center rounded-full bg-red-500/10 font-display text-2xl font-bold text-red-400">
              ✕
            </p>
            <div className="space-y-1">
              <p className="font-display text-xl font-bold text-zinc-100">Payment didn't land</p>
              <p className="mx-auto max-w-md text-sm text-zinc-400">{msg}</p>
            </div>
            {reference && (
              <p className="truncate font-mono text-[11px] text-zinc-600">ref {reference} · quote it to support</p>
            )}
            <div className="flex justify-center gap-2">
              <Link href="/billing">
                <Button>Try again</Button>
              </Link>
              <Link href="/usage">
                <Button variant="outline">Check activity</Button>
              </Link>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
