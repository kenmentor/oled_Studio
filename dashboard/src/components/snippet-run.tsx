"use client";

/* Standard docs code frame: language tab, copy, playground link, ▶ Run.
 * Speech runs the FREE preview lane (≤200 chars, never billed); on success
 * an audio player (or the response body) appears in the result well. */

import { useRef, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/lib/store";
import { gateway, speakHttp } from "@/lib/gateway";
import { buildSnippet, LANG_LABEL, type Endpoint, type Lang } from "@/lib/playground";
import { EDITOR_FONT, highlight } from "@/components/code-editor";

const FILE_LABEL: Record<Lang, string> = {
  curl: "Shell",
  javascript: "JavaScript",
  python: "Python",
  sdk: "Python · SDK",
};

export default function SnippetRun({
  lang,
  endpoint,
  text = "Hello from the docs — press Run and listen.",
  voiceId = "ada",
}: {
  lang: Lang;
  endpoint: Endpoint;
  text?: string;
  voiceId?: string;
}) {
  const { ensureStudioSecret } = useAccount();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const base = gateway.base;
  const wsBase = base.replace(/^http/, "ws");
  const snippet = buildSnippet(lang, endpoint, { base, wsBase, text, voiceId });
  const playgroundHref = `/playground?endpoint=${endpoint}&lang=${lang}&text=${encodeURIComponent(text)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const run = async () => {
    if (running) return;
    setRunning(true);
    setStatus("running…");
    setAudioUrl(null);
    setBody(null);
    const started = Date.now();
    try {
      if (endpoint === "health") {
        const h = await gateway.info();
        if (!h) throw new Error("backend unreachable");
        setBody(JSON.stringify(h, null, 2));
        setStatus(`200 OK · ${((Date.now() - started) / 1000).toFixed(1)}s`);
      } else if (endpoint === "voices") {
        const list = await gateway.voices();
        if (!list) throw new Error("backend unreachable");
        setBody(JSON.stringify(list.slice(0, 6), null, 2));
        setStatus(`${list.length} voices · ${((Date.now() - started) / 1000).toFixed(1)}s`);
      } else {
        const secret = await ensureStudioSecret();
        if (!secret) throw new Error("no Studio key — is the backend on :8000?");
        const short = text.slice(0, 200); // free preview lane: never billed
        const parts: BlobPart[] = [];
        const call = speakHttp(short, (b) => parts.push(b), { voiceId, apiKey: secret, preview: true });
        const { bytes } = await call.done;
        const url = URL.createObjectURL(new Blob(parts, { type: "audio/wav" }));
        setAudioUrl(url);
        setStatus(`200 · audio/wav ${(bytes / 1024).toFixed(0)}KB · free preview — not billed`);
        requestAnimationFrame(() => void audioRef.current?.play().catch(() => {}));
      }
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#0d0d0f]">
      <div className="flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2">
        <span className="font-mono text-xs text-zinc-300">{FILE_LABEL[lang]}</span>
        <span className="ml-auto flex items-center gap-1">
          <button onClick={copy} className="rounded px-2 py-1 font-mono text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-200">
            {copied ? "copied ✓" : "copy"}
          </button>
          <Link href={playgroundHref} className="rounded px-2 py-1 font-mono text-[11px] text-zinc-500 hover:bg-white/5 hover:text-ember">
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
      <pre className="overflow-x-auto p-4" style={{ ...EDITOR_FONT, fontSize: 13 }}>
        <code className="text-[#d4d4d4]">{highlight(snippet.code, snippet.editorLang)}</code>
      </pre>
      {(status || audioUrl || body) && (
        <div className="space-y-2 border-t border-white/[0.06] bg-black/30 p-4">
          {status && <p className="font-mono text-[11px] text-zinc-400">{status}</p>}
          {body && (
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[#9cdcfe]">
              {body}
            </pre>
          )}
          {audioUrl && <audio ref={audioRef} src={audioUrl} controls className="w-full" />}
        </div>
      )}
    </div>
  );
}

/** Non-runnable reference block (install lines, static samples). */
export function StaticCode({ code, lang, title }: { code: string; lang: "bash" | "javascript" | "python"; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#0d0d0f]">
      <div className="flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2">
        <span className="font-mono text-xs text-zinc-300">{title}</span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }).catch(() => {});
          }}
          className="ml-auto rounded px-2 py-1 font-mono text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        >
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4" style={{ ...EDITOR_FONT, fontSize: 13 }}>
        <code className="text-[#d4d4d4]">{highlight(code, lang)}</code>
      </pre>
    </div>
  );
}

export { LANG_LABEL };
