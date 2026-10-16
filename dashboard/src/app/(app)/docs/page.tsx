"use client";

/* API reference, standard layout: section rail left, prose center,
 * on-this-page right. Every recipe runs for real (free preview lane for
 * speech); "open in playground" deep-links the full editor. */

import Link from "next/link";
import { useState } from "react";
import { gateway, speak as wsSpeak } from "@/lib/gateway";
import { useAccount } from "@/lib/store";
import { buildWsSnippet, INSTALL_CMD, LANG_LABEL, type Lang } from "@/lib/playground";
import { EDITOR_FONT, highlight } from "@/components/code-editor";
import SnippetRun, { StaticCode } from "@/components/snippet-run";
import { Button } from "@/components/ui";

const REFLANGS: Lang[] = ["curl", "javascript", "python", "sdk"];

const SECTIONS = [
  { id: "quickstart", label: "Quickstart" },
  { id: "auth", label: "Authentication" },
  { id: "health", label: "GET /health" },
  { id: "voices", label: "GET /v1/voices" },
  { id: "speech", label: "POST /v1/speech" },
  { id: "talk", label: "WS /v1/talk" },
  { id: "errors", label: "Errors" },
  { id: "billing", label: "Billing" },
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-6 font-display text-xl font-bold tracking-tight text-zinc-100">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] leading-7 text-zinc-400">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[13px] text-zinc-200">{children}</code>;
}

function Method({ m }: { m: "GET" | "POST" | "WS" }) {
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${
      m === "GET" ? "bg-green-500/15 text-green-400" : m === "POST" ? "bg-orange-500/15 text-orange-400" : "bg-sky-500/15 text-sky-400"
    }`}>
      {m}
    </span>
  );
}

function TalkBlock() {
  const { ensureStudioSecret } = useAccount();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const base = gateway.base;
  const wsBase = base.replace(/^http/, "ws");
  const code = buildWsSnippet("javascript", {
    base,
    wsBase,
    text: "Streaming speaks sentence by sentence.",
    voiceId: "ada",
  });

  const run = async () => {
    if (running) return;
    setRunning(true);
    setStatus("connecting…");
    try {
      const secret = await ensureStudioSecret();
      if (!secret) throw new Error("no Studio key");
      const parts: BlobPart[] = [];
      const call = wsSpeak("Streaming speaks sentence by sentence.", (b) => parts.push(b), {
        voiceId: "ada",
        apiKey: secret,
        preview: true,
      });
      const { bytes, firstChunkMs } = await call.done;
      setAudioUrl(URL.createObjectURL(new Blob(parts, { type: "audio/wav" })));
      setStatus(`done · ${(bytes / 1024).toFixed(0)}KB · first audio ${(firstChunkMs / 1000).toFixed(1)}s · free preview`);
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#0d0d0f]">
      <div className="flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2">
        <span className="font-mono text-xs text-zinc-300">stream.mjs</span>
        <span className="ml-auto flex items-center gap-1">
          <Link href="/playground?endpoint=speech&lang=javascript&transport=ws" className="rounded px-2 py-1 font-mono text-[11px] text-zinc-500 hover:bg-white/5 hover:text-ember">
            playground →
          </Link>
          <button onClick={run} disabled={running} className="rounded-md bg-ember px-3 py-1 font-mono text-[11px] font-bold text-black hover:bg-ember/90 disabled:opacity-50">
            {running ? "…" : "▶ Run"}
          </button>
        </span>
      </div>
      <pre className="overflow-x-auto p-4" style={{ ...EDITOR_FONT, fontSize: 13 }}>
        <code className="text-[#d4d4d4]">{highlight(code, "javascript")}</code>
      </pre>
      {(status || audioUrl) && (
        <div className="space-y-2 border-t border-white/[0.06] bg-black/30 p-4">
          {status && <p className="font-mono text-[11px] text-zinc-400">{status}</p>}
          {audioUrl && <audio src={audioUrl} controls className="w-full" />}
        </div>
      )}
    </div>
  );
}

const ERRORS: [string, string][] = [
  ["400 · bad_request / voice_disabled", "Missing text, bad voice, or a disabled voice. Check ids against GET /v1/voices."],
  ["401 · unauthorized / login_required", "No (or bad) API key — or session expired. Sign in again or mint a key."],
  ["402 · insufficient_credits", "Wallet empty for this render. Top up on the Billing page."],
  ["404 · unknown_voice", "No such voice id. List voices first."],
  ["429 · rate_limited / preview_budget", "Too fast, or the free preview budget is spent. Slow down or run billed."],
  ["500 · synthesis_failed", "The engine stumbled. Retry once; if it persists, report the X-Request-ID."],
];

const PARAMS: [string, string, string][] = [
  ["text", "string · 1–2000", "What gets spoken."],
  ["voice_id", "string · optional", "Defaults to your console voice. Unknown ids 404."],
  ["session_id", "string · optional", "Ephemeral generation session."],
  ["preview", "bool · default false", "Free lane: ≤200 chars, never billed."],
];

export default function DocsPage() {
  const [refLang, setRefLang] = useState<Lang>("javascript");

  return (
    <div className="space-y-6">
      <header className="space-y-2 border-b border-line pb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-50">API reference</h1>
        <p className="max-w-2xl text-[15px] leading-7 text-zinc-400">
          Nigerian-accent text-to-speech over HTTPS and WebSocket. One request in, playable WAV out.
        </p>
        <p className="font-mono text-xs text-zinc-500">{gateway.base} · TTS v1 · audio/wav · 24kHz PCM16</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">recipes in</span>
        {REFLANGS.map((l) => (
          <button
            key={l}
            onClick={() => setRefLang(l)}
            className={`rounded-md border px-2.5 py-1 font-mono text-xs ${
              refLang === l ? "border-ember/60 bg-ember/10 text-zinc-100" : "border-line text-zinc-500 hover:text-zinc-200"
            }`}
          >
            {LANG_LABEL[l]}
          </button>
        ))}
      </div>

      <div className="flex items-start gap-10">
        {/* section rail */}
        <nav className="sticky top-4 hidden w-48 shrink-0 space-y-0.5 lg:block" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="block rounded-md px-3 py-1.5 text-[13px] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
            >
              {s.label}
            </a>
          ))}
          <Link href="/playground" className="mt-3 block rounded-md bg-ember/10 px-3 py-2 text-[13px] font-semibold text-ember hover:bg-ember/15">
            Open playground →
          </Link>
        </nav>

        {/* prose */}
        <div className="min-w-0 max-w-3xl flex-1 space-y-10">
          <section id="quickstart" className="scroll-mt-6 space-y-4">
            <H2 id="quickstart">Quickstart</H2>
            <div className="space-y-2">
              <P><strong className="text-zinc-200">1 · Get a key.</strong> Mint one on the <Link href="/keys" className="text-ember hover:underline">API keys</Link> page — <Code>oled_sk_live_…</Code>, shown once.</P>
              <P><strong className="text-zinc-200">2 · Install.</strong> Only what your stack needs:</P>
              <StaticCode code={INSTALL_CMD[refLang]} lang={refLang === "curl" || refLang === "javascript" ? "bash" : "python"} title="install" />
              <P><strong className="text-zinc-200">3 · Render.</strong> Press <Code>▶ Run</Code> — audio appears below, free preview lane, never billed:</P>
              <SnippetRun lang={refLang} endpoint="speech" />
            </div>
          </section>

          <section id="auth" className="scroll-mt-6 space-y-3">
            <H2 id="auth">Authentication</H2>
            <P>Speech calls carry your key as <Code>Authorization: Bearer oled_sk_live_…</Code>. The server debits the <em>key owner's</em> wallet — 1 character costs 1 token — and answers <Code>X-Balance-Chars</Code> with what's left. <Code>GET /health</Code> and <Code>GET /v1/voices</Code> are open: no key, never billed.</P>
          </section>

          <section id="health" className="scroll-mt-6 space-y-3">
            <div className="flex items-center gap-3"><Method m="GET" /><H2 id="health">/health</H2></div>
            <P>Engine heartbeat — provider, model version, sample rate, loaded voices. Call it before anything else.</P>
            <SnippetRun lang={refLang} endpoint="health" />
          </section>

          <section id="voices" className="scroll-mt-6 space-y-3">
            <div className="flex items-center gap-3"><Method m="GET" /><H2 id="voices">/v1/voices</H2></div>
            <P>Every voice the engine can render, with accents and preview clips. Disabled voices reject synthesis with <Code>voice_disabled</Code>.</P>
            <SnippetRun lang={refLang} endpoint="voices" />
          </section>

          <section id="speech" className="scroll-mt-6 space-y-3">
            <div className="flex items-center gap-3"><Method m="POST" /><H2 id="speech">/v1/speech</H2></div>
            <P>Renders up to 2000 characters into one complete WAV. The body <em>is</em> the audio; headers carry the receipt (<Code>X-Balance-Chars</Code>, <Code>X-Request-ID</Code>).</P>
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="px-4 py-2 font-medium">param</th>
                    <th className="px-4 py-2 font-medium">type</th>
                    <th className="px-4 py-2 font-medium">notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {PARAMS.map(([n, t, d]) => (
                    <tr key={n}>
                      <td className="px-4 py-2 font-mono text-xs text-ember">{n}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">{t}</td>
                      <td className="px-4 py-2 text-zinc-400">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SnippetRun lang={refLang} endpoint="speech" text="One WAV, one request — the simplest way to speak." />
          </section>

          <section id="talk" className="scroll-mt-6 space-y-3">
            <div className="flex items-center gap-3"><Method m="WS" /><H2 id="talk">/v1/talk</H2></div>
            <P>Text in, chunked WAV back on one socket — first audio after sentence one. Frame zero is the WAV header; a <Code>done</Code> frame closes with bytes and balance. Python and SDK streaming recipes live in the playground.</P>
            <TalkBlock />
          </section>

          <section id="errors" className="scroll-mt-6 space-y-3">
            <H2 id="errors">Errors</H2>
            <P>Every failure is <Code>{"{ error: { code, message } }"}</Code> with an HTTP status. Handle the code, not the text.</P>
            <div className="overflow-hidden rounded-lg border border-line">
              <ul className="divide-y divide-line">
                {ERRORS.map(([code, fix]) => (
                  <li key={code} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
                    <code className="shrink-0 font-mono text-xs text-red-400">{code}</code>
                    <span className="text-[13px] text-zinc-400">{fix}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section id="billing" className="scroll-mt-6 space-y-3">
            <H2 id="billing">Billing</H2>
            <P>₦1 buys 1,000 tokens; 1 character costs 1 token. Top up with Paystack on the <Link href="/billing" className="text-ember hover:underline">Billing</Link> page — every kobo lands in <Link href="/billing" className="text-ember hover:underline">Transaction history</Link>. Exploring is free: renders ≤200 chars run the preview lane (cost 0, never billed).</P>
            <Link href="/playground">
              <Button>Open the playground →</Button>
            </Link>
          </section>
        </div>

        {/* on this page */}
        <aside className="sticky top-4 hidden w-44 shrink-0 xl:block" aria-label="On this page">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">on this page</p>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="block border-l border-line px-3 py-1 text-[12px] text-zinc-500 hover:border-ember hover:text-zinc-200">
              {s.label}
            </a>
          ))}
        </aside>
      </div>
    </div>
  );
}
