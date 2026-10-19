"use client";

/* API reference, calm edition: one guided path instead of three columns.
 * Quickstart is always visible (key → install → first render, runnable).
 * Every endpoint lives behind a quiet accordion — open one at a time.
 * Nothing here bills: runners use the free preview lane. */

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { gateway, speak as wsSpeak } from "@/lib/gateway";
import { DocsHeader } from "@/components/docs-header";
import {
  buildWsSnippet,
  INSTALL_CMD,
  LANG_LABEL,
  type Lang,
} from "@/lib/playground";
import { EDITOR_FONT, highlight } from "@/components/code-editor";
import SnippetRun, { StaticCode } from "@/components/snippet-run";
import { Button } from "@/components/ui";

const REFLANGS: Lang[] = ["curl", "javascript", "python", "sdk"];

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] leading-7 text-zinc-400">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[13px] text-zinc-200">
      {children}
    </code>
  );
}

function Method({ m }: { m: "GET" | "POST" | "WS" }) {
  return (
    <span
      className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${
        m === "GET"
          ? "bg-green-500/15 text-green-400"
          : m === "POST"
            ? "bg-orange-500/15 text-orange-400"
            : "bg-sky-500/15 text-sky-400"
      }`}
    >
      {m}
    </span>
  );
}

/* One quiet accordion per topic. Only one open at a time — the page
 * never shows more than the reader asked for. Native <details> keeps
 * it keyboard-accessible with zero state to break. Each topic answers
 * two questions in order: what is this thing, and how do I use it. */
function Topic({
  id,
  method,
  title,
  blurb,
  what,
  how,
  children,
  defaultOpen,
}: {
  id: string;
  method?: "GET" | "POST" | "WS";
  title: string;
  blurb: string;
  what: string;
  how: ReactNode[];
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className="group scroll-mt-6 overflow-hidden rounded-xl border border-line bg-surface"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 transition-colors hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        {method && <Method m={method} />}
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[15px] font-semibold text-zinc-100">
            {title}
          </span>
          <span className="block truncate text-[13px] text-zinc-500">
            {blurb}
          </span>
        </span>
        <span className="shrink-0 font-mono text-sm text-zinc-600 transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="space-y-4 border-t border-line px-5 py-5">
        <P>
          <strong className="text-zinc-200">What this is.</strong> {what}
        </P>
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
            how to use it
          </p>
          <ol className="list-decimal space-y-1.5 pl-5 text-[14px] leading-6 text-zinc-400">
            {how.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
        {children}
      </div>
    </details>
  );
}

function TalkBlock() {
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
      const parts: BlobPart[] = [];
      const call = wsSpeak(
        "Streaming speaks sentence by sentence.",
        (b) => parts.push(b),
        {
          voiceId: "ada",
          apiKey: "",
          preview: true,
        },
      );
      const { bytes, firstChunkMs } = await call.done;
      setAudioUrl(URL.createObjectURL(new Blob(parts, { type: "audio/wav" })));
      setStatus(
        `done · ${(bytes / 1024).toFixed(0)}KB · first audio ${(firstChunkMs / 1000).toFixed(1)}s · free preview`,
      );
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
          <Link
            href="/playground?endpoint=speech&lang=javascript&transport=ws"
            className="rounded px-2 py-1 font-mono text-[11px] text-zinc-500 hover:bg-white/5 hover:text-ember"
          >
            playground →
          </Link>
          <button
            onClick={run}
            disabled={running}
            className="rounded-md bg-ember px-3 py-1 font-mono text-[11px] font-bold text-black hover:bg-ember/90 disabled:opacity-50"
          >
            {running ? "…" : "▶ Run"}
          </button>
        </span>
      </div>
      <pre
        className="overflow-x-auto p-4"
        style={{ ...EDITOR_FONT, fontSize: 13 }}
      >
        <code className="text-[#d4d4d4]">{highlight(code, "javascript")}</code>
      </pre>
      {(status || audioUrl) && (
        <div className="space-y-2 border-t border-white/[0.06] bg-black/30 p-4">
          {status && (
            <p className="font-mono text-[11px] text-zinc-400">{status}</p>
          )}
          {audioUrl && <audio src={audioUrl} controls className="w-full" />}
        </div>
      )}
    </div>
  );
}

const ERRORS: [string, string][] = [
  [
    "400 · bad_request / voice_disabled",
    "Missing text, bad voice, or a disabled voice. Check ids against GET /v1/voices.",
  ],
  [
    "401 · unauthorized / login_required",
    "No (or bad) API key — or session expired. Sign in again or mint a key.",
  ],
  [
    "402 · insufficient_credits",
    "Wallet empty for this render. Top up on the Billing page.",
  ],
  ["404 · unknown_voice", "No such voice id. List voices first."],
  [
    "429 · rate_limited / preview_budget",
    "Too fast, or the free preview budget is spent. Slow down or run billed.",
  ],
  [
    "500 · synthesis_failed",
    "The engine stumbled. Retry once; if it persists, report the X-Request-ID.",
  ],
];

const PARAMS: [string, string, string][] = [
  ["text", "string · 1–2000", "What gets spoken."],
  [
    "voice_id",
    "string · optional",
    "Defaults to your console voice. Unknown ids 404.",
  ],
  ["session_id", "string · optional", "Ephemeral generation session."],
  ["preview", "bool · default false", "Free lane: ≤200 chars, never billed."],
];

export default function DocsPage() {
  const [refLang, setRefLang] = useState<Lang>("javascript");

  return (
    <>
      <DocsHeader />
      <div className="mx-auto w-full max-w-3xl space-y-6 pt-7">
        <div className="flex flex-wrap items-center gap-2">
          {REFLANGS.map((l) => (
            <button
              key={l}
              onClick={() => setRefLang(l)}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs ${
                refLang === l
                  ? "border-ember/60 bg-ember/10 text-zinc-100"
                  : "border-line text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {LANG_LABEL[l]}
            </button>
          ))}
        </div>

        {/* The guided path: key → install → first render. Always visible. */}
        <section className="space-y-4 rounded-xl border border-ember/25 bg-ember/[0.04] p-5 sm:p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember">
            start here · 3 steps
          </p>
          <div className="space-y-2">
            <P>
              <strong className="text-zinc-200">1 · Get a key.</strong> Mint one
              on the{" "}
              <Link href="/keys" className="text-ember hover:underline">
                API keys
              </Link>{" "}
              page — <Code>oled_sk_live_…</Code>, shown once.
            </P>
            <P>
              <strong className="text-zinc-200">2 · Install.</strong> Only what
              your stack needs:
            </P>
            <StaticCode
              code={INSTALL_CMD[refLang]}
              lang={
                refLang === "curl" || refLang === "javascript"
                  ? "bash"
                  : "python"
              }
              title="install"
            />
            <P>
              <strong className="text-zinc-200">3 · Render.</strong> Press{" "}
              <Code>▶ Run</Code> — audio appears below, free preview lane, never
              billed:
            </P>
            <SnippetRun lang={refLang} endpoint="speech" />
          </div>
        </section>

        {/* Everything else: one open at a time. */}
        <div className="space-y-3">
          <Topic
            id="auth"
            title="Authentication"
            blurb="where the key goes · what gets billed"
            what="The key proves which wallet pays. Every speech call carries it in the Authorization header, the server debits that wallet 1 token per character, and tells you the remaining balance in the X-Balance-Chars response header."
            how={[
              <>
                Mint a key on the{" "}
                <Link href="/keys" className="text-ember hover:underline">
                  API keys
                </Link>{" "}
                page and copy the <Code>oled_sk_live_…</Code> secret — it shows
                once.
              </>,
              <>
                Send it as <Code>Authorization: Bearer oled_sk_live_…</Code> on
                every speech call (or <Code>api_key</Code> inside the{" "}
                <Code>/v1/talk</Code> message).
              </>,
              <>
                Read <Code>X-Balance-Chars</Code> after each render; when it
                nears zero, top up on{" "}
                <Link href="/billing" className="text-ember hover:underline">
                  Billing
                </Link>{" "}
                before users notice.
              </>,
            ]}
          >
            <P>
              <Code>GET /health</Code> and <Code>GET /v1/voices</Code> are open:
              no key, never billed. Everything that synthesizes needs one.
            </P>
          </Topic>

          <Topic
            id="health"
            method="GET"
            title="/health"
            blurb="engine heartbeat — call it first"
            what="A tiny JSON report saying the engine is alive: which provider is loaded, which model version, the sample rate, and how many voices are ready. It costs nothing and needs no key."
            how={[
              <>
                Call it once when your app boots — if it fails, don't bother
                calling anything else yet.
              </>,
              <>
                Check <Code>voices</Code> is above zero and{" "}
                <Code>model_version</Code> matches what you tested against.
              </>,
              <>
                Point your status page or uptime monitor at it;{" "}
                <Code>ok: true</Code> means serving.
              </>,
            ]}
          >
            <SnippetRun lang={refLang} endpoint="health" />
          </Topic>

          <Topic
            id="voices"
            method="GET"
            title="/v1/voices"
            blurb="every renderable voice + accents"
            what="The full menu of voices the engine can speak with right now — ids, labels, accents, and which ones are switched on. Voice ids are what you pass as voice_id everywhere else."
            how={[
              <>
                Fetch the list and let your users pick from it instead of
                hardcoding voice names.
              </>,
              <>
                Play each voice's <Code>sample_url</Code> so people hear before
                they commit.
              </>,
              <>
                If a render ever answers <Code>voice_disabled</Code>, re-fetch
                this list — that voice was switched off.
              </>,
            ]}
          >
            <SnippetRun lang={refLang} endpoint="voices" />
          </Topic>

          <Topic
            id="speech"
            method="POST"
            title="/v1/speech"
            blurb="one request → one complete WAV"
            what="The simplest way to speak: you send text (up to 2000 characters) and get back one complete WAV file. The audio IS the response body; the receipt — remaining balance, request id, voice used — rides in the response headers."
            how={[
              <>
                POST your text with <Code>voice_id</Code> and your key; save the
                response bytes as <Code>.wav</Code> and play them.
              </>,
              <>
                Keep <Code>X-Balance-Chars</Code> from the headers and update
                your UI before the next render.
              </>,
              <>
                Need a preview first? Add <Code>{"preview: true"}</Code> (≤200
                chars) — real audio, costs nothing, never billed.
              </>,
            ]}
          >
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
                      <td className="px-4 py-2 font-mono text-xs text-ember">
                        {n}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">
                        {t}
                      </td>
                      <td className="px-4 py-2 text-zinc-400">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SnippetRun
              lang={refLang}
              endpoint="speech"
              text="One WAV, one request — the simplest way to speak."
            />
          </Topic>

          <Topic
            id="talk"
            method="WS"
            title="/v1/talk"
            blurb="streaming socket · first audio fast"
            what="A WebSocket for long text: you send sentences down one socket and audio chunks stream back while the rest is still rendering, so playback starts after sentence one instead of after the whole document. A done frame closes with total bytes and your balance."
            how={[
              <>
                Open the socket and send{" "}
                <Code>{"{type: 'speak', text, voice_id, api_key}"}</Code> —
                include the key inside the message, not a header.
              </>,
              <>
                Play each binary frame as it arrives; the very first frame is
                the WAV header, so feed an incremental player.
              </>,
              <>
                Wait for the <Code>done</Code> frame before closing — it carries{" "}
                <Code>balance_chars</Code> for your UI.
              </>,
            ]}
          >
            <P>Python and SDK streaming recipes live in the playground.</P>
            <TalkBlock />
          </Topic>

          <Topic
            id="errors"
            title="Errors"
            blurb="every failure shape, one list"
            what="When anything goes wrong you get the same envelope every time — an HTTP status plus { error: { code, message } }. The code is stable and documented; the message is human flavor that may change, so branch your logic on the code."
            how={[
              <>
                On 401, refresh the key or sign in again — never retry with the
                same secret in a loop.
              </>,
              <>
                On 402, send the user to{" "}
                <Link href="/billing" className="text-ember hover:underline">
                  Billing
                </Link>{" "}
                — the wallet is empty, retries can't help.
              </>,
              <>
                On 429 or 500, wait and retry once with backoff; include the{" "}
                <Code>X-Request-ID</Code> if you contact support.
              </>,
            ]}
          >
            <div className="overflow-hidden rounded-lg border border-line">
              <ul className="divide-y divide-line">
                {ERRORS.map(([code, fix]) => (
                  <li
                    key={code}
                    className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-4"
                  >
                    <code className="shrink-0 font-mono text-xs text-red-400">
                      {code}
                    </code>
                    <span className="text-[13px] text-zinc-400">{fix}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Topic>

          <Topic
            id="billing"
            title="Billing"
            blurb="tokens, top-ups, free lane"
            what="Prepaid tokens, not subscriptions: ₦1 buys 1,000 tokens and rendering 1 character burns 1 token. You top up with Paystack (card typed on Paystack's page, never here), the webhook credits your wallet, and every kobo is listed under Transaction history."
            how={[
              <>
                Fund the wallet on the{" "}
                <Link href="/billing" className="text-ember hover:underline">
                  Billing
                </Link>{" "}
                page — start small, watch the tokens land.
              </>,
              <>
                Just exploring? Keep renders under 200 chars with{" "}
                <Code>{"preview: true"}</Code> — free lane, never billed.
              </>,
              <>
                Track spend per key on the{" "}
                <Link href="/usage" className="text-ember hover:underline">
                  Usage
                </Link>{" "}
                page; rotate a key the moment its numbers look wrong.
              </>,
            ]}
          >
            <Link href="/playground">
              <Button>Open the playground →</Button>
            </Link>
          </Topic>
        </div>
      </div>
    </>
  );
}
