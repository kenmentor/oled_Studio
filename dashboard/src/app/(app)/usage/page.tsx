"use client";

import { useEffect, useMemo, useState } from "react";
import { gateway, useServerBalance } from "@/lib/gateway";
import { compact, dateTime, tokensMoney, useAccount, type UsageEvent } from "@/lib/store";
import { Badge, Button, Card, CardHead, Input } from "@/components/ui";
import { Bars } from "@/components/charts";
import RequestDrawer from "@/components/request-drawer";
import { IconDownload, IconSearch } from "@/components/icons";

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

function toCsv(rows: ServerRow[]): string {
  const head = "id,at,status,mode,voice,key,characters,text";
  const body = rows
    .map((e) =>
      [
        e.id,
        e.at,
        e.status,
        e.mode,
        `"${e.voice}"`,
        `"${e.key_name}"`,
        e.chars,
        `"${e.text.replace(/"/g, '""')}"`,
      ].join(",")
    )
    .join("\n");
  return `${head}\n${body}`;
}

export default function UsagePage() {
  const { account } = useAccount();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<UsageEvent | null>(null);
  const [events, setEvents] = useState<ServerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = (uid: string) =>
    gateway.usage(500, uid).then((r) => {
      if (r) setEvents(r.events);
      setLoading(false);
    });

  useEffect(() => {
    setLoading(true);
    void load(account?.uid ?? "");
    const onBal = () => void load(account?.uid ?? "");
    window.addEventListener("oled-balance", onBal);
    return () => window.removeEventListener("oled-balance", onBal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.uid]);

  const live = useServerBalance(account?.uid ?? "");

  /* One plot for spoken usage: billed chars per bucket, narrowable from
   * 30 days down to the last 24 hours or any custom window. Done renders
   * only — errors cost nothing, so they would lie on a money chart. */
  type Range = "24h" | "7d" | "30d" | "custom";
  const RANGES: { id: Range; label: string }[] = [
    { id: "24h", label: "24H" },
    { id: "7d", label: "7D" },
    { id: "30d", label: "30D" },
    { id: "custom", label: "Custom" },
  ];
  const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
  const [range, setRange] = useState<Range>("7d");
  const [from, setFrom] = useState(() => isoDay(Date.now() - 6 * 86400000));
  const [to, setTo] = useState(() => isoDay(Date.now()));

  const plot = useMemo(() => {
    const DAY = 86400000;
    const HOUR = 3600000;
    const done = events.filter((e) => e.status === "done");
    const now = Date.now();
    let start: number;
    let step: number;
    let count: number;
    let per: string;
    if (range === "24h") {
      start = Math.floor(now / HOUR) * HOUR - 23 * HOUR;
      step = HOUR;
      count = 24;
      per = "/hr";
    } else if (range === "custom") {
      let s = Date.parse(from);
      let e = Date.parse(to) + DAY;
      if (!Number.isFinite(s) || !Number.isFinite(e)) {
        s = now - 6 * DAY;
        e = now + DAY;
      }
      if (s >= e) e = s + DAY;
      if (e - s <= 2 * DAY) {
        // short window: hourly buckets, capped at 48
        if (e - s > 48 * HOUR) s = e - 48 * HOUR;
        start = s;
        step = HOUR;
        count = Math.max(1, Math.ceil((e - s) / HOUR));
        per = "/hr";
      } else {
        // long window: daily buckets, capped at 92 days
        if (e - s > 92 * DAY) s = e - 92 * DAY;
        start = s;
        step = DAY;
        count = Math.max(1, Math.ceil((e - s) / DAY));
        per = "/day";
      }
    } else {
      const days = range === "30d" ? 30 : 7;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      start = today.getTime() - (days - 1) * DAY;
      step = DAY;
      count = days;
      per = "/day";
    }
    const end = start + count * step;
    const values = new Array<number>(count).fill(0);
    let renders = 0;
    for (const e of done) {
      const t = Date.parse(e.at);
      if (!Number.isFinite(t) || t < start || t >= end) continue;
      values[Math.min(count - 1, Math.floor((t - start) / step))] += e.chars;
      renders += 1;
    }
    const hourly = step === HOUR;
    const labels = values.map((_, i) => {
      const d = new Date(start + i * step);
      if (hourly) return `${String(d.getHours()).padStart(2, "0")}:00`;
      return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    });
    return { values, labels, per, total: values.reduce((a, b) => a + b, 0), renders };
  }, [events, range, from, to]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events
      .filter((e) => (needle ? `${e.text} ${e.voice} ${e.key_name}`.toLowerCase().includes(needle) : true))
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [events, q]);

  if (!account) return null;

  const download = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `oled-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Activity</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {live ? (
              <>
                {tokensMoney(live.balance)} left · {events.length} billed renders
              </>
            ) : (
              "connecting…"
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={download} disabled={rows.length === 0}>
          <IconDownload className="size-4" />
          Export CSV
        </Button>
      </header>

      <Card>
        <CardHead
          title="Usage"
          hint={`${plot.renders} renders · ${compact(plot.total)} chars`}
          children={
            <div
              role="group"
              aria-label="Time range"
              className="flex shrink-0 items-center gap-0.5 rounded-md border border-line p-0.5"
            >
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  aria-pressed={range === r.id}
                  className={
                    range === r.id
                      ? "rounded px-2 py-1 font-mono text-[11px] text-zinc-100 bg-surface-2"
                      : "rounded px-2 py-1 font-mono text-[11px] text-zinc-600 hover:text-zinc-300"
                  }
                >
                  {r.label}
                </button>
              ))}
            </div>
          }
        />
        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From date"
              className="w-auto"
            />
            <span className="font-mono text-[11px] text-zinc-600">→</span>
            <Input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              aria-label="To date"
              className="w-auto"
            />
          </div>
        )}
        <div className="px-5 py-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-zinc-600">Loading your renders…</p>
          ) : (
            <Bars
              values={plot.values}
              labels={plot.labels}
              per={plot.per}
              format={(v) => `${compact(v)} chars`}
              formatAxis={(v) => compact(v)}
            />
          )}
        </div>
      </Card>

      <Card>
        <div className="border-b border-line p-4 sm:px-6">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-2.5 size-4 text-zinc-600" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search renders…"
              aria-label="Search renders"
              className="pl-9"
            />
          </div>
        </div>

        {loading ? (
          <p className="px-6 py-12 text-center text-sm text-zinc-600">Loading your renders…</p>
        ) : rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-zinc-600">
            {q ? "Nothing matches that search." : "No renders yet — say something in Studio."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setOpen(toEvent(e))}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2 sm:px-6"
                >
                  <Badge tone={e.status === "done" ? "green" : "red"}>{e.mode}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-200">
                      {e.text || `(${compact(e.chars)} tokens)`}
                    </span>
                    <span className="mt-1 block font-mono text-[11px] text-zinc-600">
                      {dateTime(Date.parse(e.at) || Date.now())}
                      {e.voice ? ` · ${e.voice}` : ""}
                      {e.key_name ? ` · ${e.key_name}` : ""} · {compact(e.chars)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <RequestDrawer event={open} onClose={() => setOpen(null)} />
    </div>
  );
}
