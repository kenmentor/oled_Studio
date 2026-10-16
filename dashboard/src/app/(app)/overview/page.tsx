"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { compact, timeAgo, tokensMoney, useAccount, type UsageEvent } from "@/lib/store";
import { gateway, useGatewayHealth, useServerBalance } from "@/lib/gateway";
import { Badge, Button, Card, CardHead, Dot, SectionLabel } from "@/components/ui";
import RequestDrawer from "@/components/request-drawer";
import {
  IconArrowRight,
  IconKeys,
  IconMic,
  IconPlay,
  IconStudio,
} from "@/components/icons";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

interface ServerRow {
  id: string;
  at: string;
  key_name: string;
  voice: string;
  chars: number;
  text: string;
  audio_seconds: number;
  latency_ms: number;
  mode: string;
  status: string;
}

function toEvent(e: ServerRow): UsageEvent {
  return {
    id: e.id,
    at: Date.parse(e.at) || Date.now(),
    keyName: e.key_name || "Studio",
    voiceName: e.voice || "—",
    characters: e.chars,
    audioSeconds: e.audio_seconds ?? 0,
    latencyMs: e.latency_ms ?? 0,
    mode: e.mode === "stream" ? "stream" : "batch",
    status: e.status === "done" ? "done" : "error",
    text: e.text || "(no text stored)",
    costKobo: 0,
  };
}

export default function OverviewPage() {
  const { account } = useAccount();
  const health = useGatewayHealth();
  const live = useServerBalance(account?.uid ?? "");
  const [rows, setRows] = useState<ServerRow[]>([]);
  const [open, setOpen] = useState<UsageEvent | null>(null);

  useEffect(() => {
    if (!account?.uid) return;
    let alive = true;
    const load = () =>
      gateway.usage(6, account.uid).then((r) => {
        if (alive && r) setRows(r.events);
      });
    void load();
    const onBal = () => void load();
    window.addEventListener("oled-balance", onBal);
    return () => {
      alive = false;
      window.removeEventListener("oled-balance", onBal);
    };
  }, [account?.uid]);

  if (!account) return null;

  const balance = live?.balance ?? null;
  const spent = live?.spent ?? 0;
  const recent = rows.map(toEvent);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {greeting()}, {account.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {live ? `${compact(spent)} used · ${compact(balance ?? 0)} left` : "connecting to your wallet…"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/keys">
            <Button variant="outline" size="sm">
              <IconKeys className="size-5" />
              New key
            </Button>
          </Link>
          <Link href="/studio">
            <Button size="sm">
              <IconPlay className="size-3" />
              Open studio
            </Button>
          </Link>
        </div>
      </header>

      {/* The wallet: balance and used. Nothing else competes with it. */}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Card className="min-w-0 overflow-hidden p-6 sm:p-8">
          <SectionLabel>Balance</SectionLabel>
          <p className="tabular mt-3 break-words font-display text-4xl font-semibold leading-tight">
            {balance === null ? "···" : tokensMoney(balance)}
          </p>
          <p className="mt-2 text-xs text-zinc-600">
            {balance === null ? (
              "connecting…"
            ) : (
              <>
                {compact(balance)} tokens ·{" "}
                <Link href="/billing" className="hover:text-ember">
                  {balance <= 0 ? "empty — fund wallet →" : "fund wallet →"}
                </Link>
              </>
            )}
          </p>
        </Card>
        <Card className="min-w-0 overflow-hidden p-6 sm:p-8">
          <SectionLabel>Used</SectionLabel>
          <p className="tabular mt-3 font-display text-4xl font-semibold">
            {live ? compact(spent) : "···"}
          </p>
          <p className="mt-2 text-xs text-zinc-600">
            {live ? `tokens · ≈ ${tokensMoney(spent)} consumed` : "connecting…"}
          </p>
        </Card>
      </div>

      <Card>
        <CardHead
          title="Recent activity"
          children={
            <Link href="/usage">
              <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-ember">
                All activity <IconArrowRight className="size-3" />
              </span>
            </Link>
          }
        />
        <ul className="divide-y divide-line">
          {recent.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => setOpen(e)}
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2"
              >
                <Badge tone={e.status === "done" ? "green" : "red"}>{e.mode}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{e.text}</span>
                <span className="tabular shrink-0 font-mono text-[11px] text-zinc-600">
                  {timeAgo(e.at)}
                </span>
              </button>
            </li>
          ))}
          {recent.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-zinc-600">
              Nothing yet — open the studio and say something.
            </li>
          )}
        </ul>
      </Card>

      <Card>
        <CardHead
          title="Backend"
          children={
            <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-zinc-500">
              <Dot tone={health.online ? "green" : "red"} />
              {health.online ? "reachable" : "unreachable"}
            </span>
          }
        />
        <div className="px-5 py-4">
          <p className="font-mono text-[11px] text-zinc-600">
            {health.online
              ? `${health.voices ?? 0} voices · ${health.modelVersion ?? "backend"}`
              : "start it on :8000"}
          </p>
        </div>
      </Card>

      <Card>
        <CardHead title="Next up" />
        <div className="divide-y divide-line">
          <Link href="/keys" className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
            <IconKeys className="size-5 text-zinc-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">Create a key for your app</span>
              <span className="block text-xs text-zinc-600">
                {account.keys.length
                  ? `${account.keys.length} active — one per service is cleaner`
                  : "you have none yet"}
              </span>
            </span>
            <IconArrowRight className="size-4 text-zinc-700" />
          </Link>
          <Link href="/voices" className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
            <IconMic className="size-5 text-zinc-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">Hear the voices</span>
              <span className="block text-xs text-zinc-600">
                Preview each one, then set your default
              </span>
            </span>
            <IconArrowRight className="size-4 text-zinc-700" />
          </Link>
          <Link href="/studio" className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
            <IconStudio className="size-5 text-zinc-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">Render in the studio</span>
              <span className="block text-xs text-zinc-600">
                1 character of text costs 1 token
              </span>
            </span>
            <IconArrowRight className="size-4 text-zinc-700" />
          </Link>
        </div>
      </Card>

      <RequestDrawer event={open} onClose={() => setOpen(null)} />
    </div>
  );
}
