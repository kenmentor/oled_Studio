"use client";

/* Public docs code frame.
 * Health and voices can run without an account.
 * Speech uses the explicitly permitted FREE preview lane (<= 200 chars).
 * Paid production synthesis must still be authenticated by the backend.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { gateway, speakHttp } from "@/lib/gateway";
import {
  buildSnippet,
  LANG_LABEL,
  type Endpoint,
  type Lang,
} from "@/lib/playground";
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
  // No useAccount(): public documentation must render without a login.
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const base = gateway.base;
  const wsBase = base.replace(/^http/, "ws");

  const snippet = buildSnippet(lang, endpoint, {
    base,
    wsBase,
    text,
    voiceId,
  });

  const playgroundHref =
    `/playground?endpoint=${endpoint}&lang=${lang}` +
    `&text=${encodeURIComponent(text)}`;

  // Release generated audio when it is replaced or this component unmounts.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setStatus("Copy failed. Check clipboard permissions.");
    }
  };

  const run = async () => {
    if (running) return;

    setRunning(true);
    setStatus("Running…");
    setAudioUrl(null);
    setBody(null);

    const started = Date.now();

    try {
      if (endpoint === "health") {
        const result = await gateway.info();

        if (!result) {
          throw new Error("Backend unreachable. Check the API URL.");
        }

        setBody(JSON.stringify(result, null, 2));
        setStatus(`200 OK · ${((Date.now() - started) / 1000).toFixed(1)}s`);
      } else if (endpoint === "voices") {
        const result = await gateway.voices();

        if (!result) {
          throw new Error("Backend unreachable. Check the API URL.");
        }

        setBody(JSON.stringify(result.slice(0, 6), null, 2));
        setStatus(
          `${result.length} voices · ${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
      } else if (endpoint === "speech") {
        // Public preview: no account lookup and no user API key.
        // The backend must explicitly allow this limited preview request.
        const previewText = text.slice(0, 200);
        const audioParts: BlobPart[] = [];

        const request = speakHttp(
          previewText,
          (chunk) => audioParts.push(chunk),
          {
            voiceId,
            apiKey: "",
            preview: true,
          },
        );

        const { bytes } = await request.done;

        if (audioParts.length === 0) {
          throw new Error("The server returned no audio.");
        }

        const url = URL.createObjectURL(
          new Blob(audioParts, { type: "audio/wav" }),
        );

        setAudioUrl(url);
        setStatus(
          `200 OK · ${(bytes / 1024).toFixed(0)} KB · free preview, not billed`,
        );

        // Playback is best-effort; the user can also press Play manually.
        window.setTimeout(() => {
          void audioRef.current?.play().catch(() => {});
        }, 0);
      } else {
        throw new Error(
          `The "${endpoint}" endpoint is not supported by this runner yet.`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "An unknown error occurred.";

      setStatus(`Error: ${message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#0d0d0f]">
      <div className="flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2">
        <span className="font-mono text-xs text-zinc-300">
          {FILE_LABEL[lang]}
        </span>

        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={copy}
            className="rounded px-2 py-1 font-mono text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            {copied ? "Copied" : "Copy"}
          </button>

          <Link
            href={playgroundHref}
            className="rounded px-2 py-1 font-mono text-[11px] text-zinc-500 hover:bg-white/5 hover:text-ember"
          >
            Playground →
          </Link>

          <button
            type="button"
            onClick={run}
            disabled={running}
            className="rounded-md bg-ember px-3 py-1 font-mono text-[11px] font-bold text-black hover:bg-ember/90 disabled:opacity-50"
          >
            {running ? "Running…" : "▶ Run"}
          </button>
        </span>
      </div>

      <pre
        className="overflow-x-auto p-4"
        style={{ ...EDITOR_FONT, fontSize: 13 }}
      >
        <code className="text-[#d4d4d4]">
          {highlight(snippet.code, snippet.editorLang)}
        </code>
      </pre>

      {(status || audioUrl || body) && (
        <div className="space-y-2 border-t border-white/[0.06] bg-black/30 p-4">
          {status && (
            <p className="font-mono text-[11px] text-zinc-400">{status}</p>
          )}

          {body && (
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[#9cdcfe]">
              {body}
            </pre>
          )}

          {audioUrl && (
            <audio ref={audioRef} src={audioUrl} controls className="w-full" />
          )}
        </div>
      )}
    </div>
  );
}

/** Non-runnable reference block for install commands and static examples. */
export function StaticCode({
  code,
  lang,
  title,
}: {
  code: string;
  lang: "bash" | "javascript" | "python";
  title: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#0d0d0f]">
      <div className="flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2">
        <span className="font-mono text-xs text-zinc-300">{title}</span>

        <button
          type="button"
          onClick={copy}
          className="ml-auto rounded px-2 py-1 font-mono text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <pre
        className="overflow-x-auto p-4"
        style={{ ...EDITOR_FONT, fontSize: 13 }}
      >
        <code className="text-[#d4d4d4]">{highlight(code, lang)}</code>
      </pre>
    </div>
  );
}

export { LANG_LABEL };
