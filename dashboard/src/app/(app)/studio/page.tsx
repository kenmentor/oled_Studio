"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  compact,
  cycleEvents,
  latency,
  spentChars,
  timeAgo,
  useAccount,
} from "@/lib/store";
import { gateway, refreshBalance, speak as gatewaySpeak, speakHttp as gatewaySpeakHttp, useGatewayHealth, useServerBalance } from "@/lib/gateway";
import { Badge, Button, Card, CardHead, Dot, Modal, SectionLabel } from "@/components/ui";
import { IconPlay, IconPlus } from "@/components/icons";

export default function StudioPage() {
  const { account, revokeKey, recordUsage, refreshVoices, refreshKeys, ensureStudioSecret } = useAccount();
  const health = useGatewayHealth();
  const wallet = useServerBalance(account?.uid ?? "");

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [transport, setTransport] = useState<"ws" | "http">("ws");

  const cancelRef = useRef<(() => void) | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamPlayerRef = useRef<{ close: () => void } | null>(null);

  useEffect(
    () => () => {
      cancelRef.current?.();
      try {
        streamPlayerRef.current?.close();
      } catch {
        /* ignore */
      }
    },
    []
  );

  /* Progressive WS playback: schedule each PCM16 chunk on an AudioContext
   * as it arrives, so a 2000-char render starts speaking after the first
   * sentence instead of waiting for the full WAV. The finished Blob below
   * stays for replay/seek. HTTP mode is one-shot by design (no chunks). */
  function createPcmPlayer(sampleRate = 24000) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ sampleRate });
    void ctx.resume().catch(() => {});
    let nextTime = ctx.currentTime;
    let closed = false;
    return {
      push(buf: ArrayBuffer, isFirst: boolean) {
        if (closed) return;
        let bytes = new Uint8Array(buf);
        if (isFirst) {
          // First WS binary frame is the 44-byte WAV header, not audio.
          if (bytes.length >= 44 && bytes[0] === 0x52 && bytes[1] === 0x49) {
            bytes = bytes.slice(44);
          } else if (bytes.length <= 44) {
            return;
          }
        }
        if (bytes.length < 2) return;
        const len = Math.floor(bytes.length / 2);
        const audioBuf = ctx.createBuffer(1, len, sampleRate);
        const ch = audioBuf.getChannelData(0);
        const view = new DataView(bytes.buffer, bytes.byteOffset, len * 2);
        for (let i = 0; i < len; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
        const src = ctx.createBufferSource();
        src.buffer = audioBuf;
        nextTime = Math.max(nextTime, ctx.currentTime);
        src.connect(ctx.destination);
        src.start(nextTime);
        nextTime += audioBuf.duration;
      },
      close() {
        closed = true;
        void ctx.close().catch(() => {});
      },
    };
  }
  useEffect(() => {
    void refreshVoices();
    void refreshKeys();
  }, [refreshVoices, refreshKeys]);

  if (!account) return null;

  const voice =
    account.voices.find((v) => v.id === account.defaultVoiceId && v.enabled) ??
    account.voices.find((v) => v.enabled) ??
    account.voices[0];
  const recent = cycleEvents(account).slice(0, 4);
  const spent = spentChars(account);

  /* -- speak: every render spends from THIS account's wallet.
   *  The secret always belongs to account.uid (auto-provisioned when the
   *  stored one didn't survive), so the server debits the same balance
   *  the sidebar shows. No secret + offline = blocked, never persona. */
  const play = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setStatus("rendering…");
    setError(null);

    const secret = await ensureStudioSecret();
    if (!secret) {
      setBusy(false);
      setStatus(null);
      setError(
        health.online
          ? "Couldn't get a Studio key — open API keys and create one."
          : "Backend unreachable — start it on :8000, then try again."
      );
      return;
    }
    const keyName = account.keys.find((k) => k.secret === secret)?.name ?? "Studio";

    try {
      streamPlayerRef.current?.close();
    } catch {
      /* ignore */
    }
    streamPlayerRef.current = null;

    const streaming = transport !== "http";
    let player: ReturnType<typeof createPcmPlayer> | null = null;
    try {
      player = streaming ? createPcmPlayer(24000) : null;
      console.info(`[studio] play start chars=${value.length} transport=${transport} voice=${voice?.id ?? "?"} live=${player ? "on" : "off"}`);
    } catch (err) {
      console.warn("[studio] live player unavailable, blob-only fallback", err);
      player = null;
    }
    if (player) streamPlayerRef.current = player;
    let chunks = 0;
    let liveFailed = false;

    const parts: BlobPart[] = [];
    const render = transport === "http" ? gatewaySpeakHttp : gatewaySpeak;
    const call = render(
      value,
      (buf) => {
        parts.push(buf);
        if (player) {
          chunks += 1;
          try {
            player.push(buf, chunks === 1);
          } catch (err) {
            liveFailed = true;
            try {
              console.warn("[studio] live playback failed, blob-only fallback", err);
            } catch {
              /* ignore */
            }
          }
        }
      },
      { voiceId: voice?.id, apiKey: secret }
    );
    cancelRef.current = () => {
      try {
        call.cancel();
      } catch {
        /* ignore */
      }
      try {
        streamPlayerRef.current?.close();
      } catch {
        /* ignore */
      }
      streamPlayerRef.current = null;
    };
    const started = Date.now();

    try {
      const { bytes, firstChunkMs } = await call.done;
      const url = URL.createObjectURL(new Blob(parts, { type: "audio/wav" }));
      if (audioRef.current) {
        audioRef.current.src = url;
        if (!streaming) void audioRef.current.play().catch(() => {});
      }
      recordUsage({
        at: started,
        keyName,
        voiceName: voice?.name ?? "Heart",
        characters: value.length,
        audioSeconds: Math.round((bytes / 2 / 24000) * 10) / 10,
        latencyMs: firstChunkMs < 0 ? Date.now() - started : firstChunkMs,
        mode: transport === "http" ? "batch" : "stream",
        status: "done",
        text: value,
      });
      const summary =
        transport === "http"
          ? `one wav in ${((Date.now() - started) / 1000).toFixed(1)}s · http`
          : firstChunkMs >= 0
            ? `first audio ${latency(firstChunkMs)} · live ${chunks} chunks${liveFailed ? " (player failed — blob only)" : ""} · ${((Date.now() - started) / 1000).toFixed(1)}s total · ws`
            : `${((Date.now() - started) / 1000).toFixed(1)}s · live ${chunks} chunks${liveFailed ? " (player failed — blob only)" : ""} · ws`;
      setStatus(summary);
      try {
        console.info(`[studio] done bytes=${bytes} firstAudio=${firstChunkMs}ms chunks=${chunks} liveFailed=${liveFailed} — ${summary}`);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setStatus(null);
      try {
        console.warn(`[studio] render failed after ${((Date.now() - started) / 1000).toFixed(1)}s: ${(e as Error).message}`);
      } catch {
        /* ignore */
      }
      setError((e as Error).message);
      recordUsage({
        at: started,
        keyName,
        voiceName: voice?.name ?? "Heart",
        characters: value.length,
        audioSeconds: 0,
        latencyMs: Date.now() - started,
        mode: transport === "http" ? "batch" : "stream",
        status: "error",
        text: value,
      });
    } finally {
      setBusy(false);
      cancelRef.current = null;
      refreshBalance();
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Studio</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-zinc-500">
            <Dot tone={health.online ? "green" : "red"} />
            {health.online
              ? `${health.voices ?? 0} voice${health.voices === 1 ? "" : "s"} ready · ${
                  health.modelVersion ?? ""
                }`
              : "backend unreachable — start it on :8000"}
          </p>
        </div>
        <Link href="/voices">
          <Button variant="outline" size="sm">
            <IconPlus className="size-3.5" />
            Clone a voice
          </Button>
        </Link>
      </header>

      {/* the one interactive surface */}
      <Card>
        <CardHead
          title="Say something"
          hint={`${voice?.name ?? "Heart"} · ${voice?.accent ?? ""}`}
          children={
            <span className="tabular font-mono text-[11px] text-zinc-600">
              {text.length}/2000
            </span>
          }
        />
        <div className="space-y-4 p-5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 2000))}
            rows={3}
            placeholder="Type anything…"
            className="w-full resize-none rounded-md border border-line bg-void px-3 py-2.5 text-sm leading-relaxed placeholder:text-zinc-700 focus:border-ember/50"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-zinc-600">
              {status ?? (transport === "http"
                ? `one wav per render over ${gateway.base}/v1/speech`
                : `streams over ${gateway.base.replace(/^http/, "ws")}/v1/talk`)}
              {wallet !== null && wallet !== undefined && (
                <>
                  {" · "}
                  {wallet.balance <= 0 ? (
                    <Link href="/billing" className="text-ember hover:underline">
                      wallet empty — fund it →
                    </Link>
                  ) : (
                    `${compact(wallet.balance)} left`
                  )}
                </>
              )}
            </span>
            <div className="flex gap-2">
              <div
                role="group"
                aria-label="Transport"
                className="flex h-9 items-center rounded-md border border-line p-0.5 text-xs"
              >
                {(["ws", "http"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={busy}
                    onClick={() => setTransport(t)}
                    aria-pressed={transport === t}
                    title={t === "ws" ? "WebSocket /v1/talk — chunked audio" : "HTTP /v1/speech — one WAV"}
                    className={`rounded px-2.5 py-1 font-mono uppercase transition-colors disabled:opacity-50 ${
                      transport === t
                        ? "bg-ember font-bold text-black"
                        : "text-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {t === "ws" ? "WS" : "HTTP"}
                  </button>
                ))}
              </div>
              {busy && (
                <Button variant="ghost" onClick={() => cancelRef.current?.()}>
                  Stop
                </Button>
              )}
              <Button onClick={play} disabled={busy || !text.trim()}>
                <IconPlay className="size-3" />
                {busy ? "Rendering…" : "Play"}
              </Button>
            </div>
          </div>
          <audio ref={audioRef} controls className="w-full" />
          {error && (
            <p className="text-xs text-red-400">
              {error}
              {/insufficient_credits|402|balance|top up/i.test(error) && (
                <>
                  {" — "}
                  <Link href="/billing" className="underline hover:text-ember">
                    top up credits
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <SectionLabel>Voice in use</SectionLabel>
          <p className="mt-1.5 text-sm">{voice?.name ?? "Heart"}</p>
          <p className="font-mono text-[11px] text-zinc-600">{voice?.accent}</p>
        </Card>
        <Card className="p-4">
          <SectionLabel>Spent this cycle</SectionLabel>
          <p className="tabular mt-1.5 font-display text-xl font-semibold">
            {compact(spent)}
            <span className="ml-1.5 text-xs font-normal text-zinc-600">chars</span>
          </p>
          <Link href="/usage" className="font-mono text-[11px] text-zinc-600 hover:text-ember">
            see usage →
          </Link>
        </Card>
        <Card className="p-4">
          <SectionLabel>Renders</SectionLabel>
          <p className="tabular mt-1.5 font-display text-xl font-semibold">
            {cycleEvents(account).length}
          </p>
          <p className="font-mono text-[11px] text-zinc-600">
            last {timeAgo(recent[0]?.at ?? null)}
          </p>
        </Card>
      </div>

      {/* keys: the second thing anyone needs, nothing more */}
      <Card>
        <CardHead
          title="API keys"
          children={
            <Link href="/keys" className="font-mono text-[11px] text-zinc-500 hover:text-ember">
              Manage →
            </Link>
          }
        />
        <ul className="divide-y divide-line">
          {account.keys.slice(0, 3).map((k) => (
            <li key={k.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{k.name}</p>
                <p className="font-mono text-[11px] text-zinc-600">
                  {k.prefix}••••{k.last4} · {timeAgo(k.lastUsedAt)}
                </p>
              </div>
              <Badge tone={k.lastUsedAt ? "green" : "neutral"}>
                {k.lastUsedAt ? "active" : "unused"}
              </Badge>
              <Button variant="danger" size="sm" onClick={() => setRevokeId(k.id)}>
                Revoke
              </Button>
            </li>
          ))}
          {account.keys.length === 0 && (
            <li className="px-5 py-6 text-sm text-zinc-600">No keys yet.</li>
          )}
        </ul>
      </Card>

      <Modal open={revokeId !== null} onClose={() => setRevokeId(null)} title="Revoke this key?">
        <p className="text-sm leading-relaxed text-zinc-400">
          Any service using it stops working immediately. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRevokeId(null)}>
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (revokeId) void revokeKey(revokeId).then(() => setRevokeId(null));
              else setRevokeId(null);
            }}
          >
            Revoke
          </Button>
        </div>
      </Modal>
    </div>
  );
}
