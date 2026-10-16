"use client";

/* Docs + live playground, dressed as the editor it teaches in. Top tabs pick
 * the REQUEST (health / voices / speech) with a gsap swap; file tabs pick
 * the language; the https/ws toggle sits on the editor and rewrites the
 * recipe; a standard-doc block continues below. Run speaks exactly what's
 * typed in the editor (parsed out of the code, sidebar as fallback). */

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useAccount } from "@/lib/store";
import { gateway, speak as wsSpeak, speakHttp, useGatewayHealth, refreshBalance } from "@/lib/gateway";
import {
  ENDPOINT_DOCS,
  ENDPOINT_LABEL,
  INSTALL_CMD,
  LANG_LABEL,
  buildSnippet,
  buildWsSnippet,
  cmdFor,
  extractSpeech,
  type Endpoint,
  type Lang,
  type TermLine,
} from "@/lib/playground";
import CodeEditor, { CHROME_FONT, EDITOR_FONT } from "@/components/code-editor";
import { Button, Card, CardHead, Dot, Input } from "@/components/ui";
import { IconFiles, IconPlay, IconTerminal, IconWarn, IconFileJs, IconFilePy, IconFileSh, IconFileSdk } from "@/components/icons";

const LANGS: Lang[] = ["curl", "javascript", "python", "sdk"];
const ENDPOINTS: Endpoint[] = ["health", "voices", "speech"];
const FILENAMES: Record<Lang, string> = {
  curl: "request.sh",
  javascript: "render.mjs",
  python: "render.py",
  sdk: "quickstart.py",
};
const FILE_ICON: Record<Lang, (p: { className?: string }) => React.ReactNode> = {
  curl: IconFileSh,
  javascript: IconFileJs,
  python: IconFilePy,
  sdk: IconFileSdk,
};

type Panel = "terminal" | "output" | "problems";
type Transport = "https" | "ws";

export default function PlaygroundPage() {
  const { account, ensureStudioSecret, refreshVoices } = useAccount();
  const health = useGatewayHealth();
  const [endpoint, setEndpoint] = useState<Endpoint>("speech");
  const [lang, setLang] = useState<Lang>("javascript");
  const [transport, setTransport] = useState<Transport>("https");
  const [text, setText] = useState("Hello from OLED Studio — this render is live.");
  const [voiceId, setVoiceId] = useState("");
  // Free preview lane (≤200 chars, unbilled). OFF = full billed render.
  const [preview, setPreview] = useState(true);
  const [code, setCode] = useState("");
  const [dirty, setDirty] = useState(false);
  const [running, setRunning] = useState(false);
  const [panel, setPanel] = useState<Panel>("terminal");
  const [sideOpen, setSideOpen] = useState(true);
  const [cursor, setCursor] = useState({ ln: 1, col: 1 });
  const [copied, setCopied] = useState(false);
  const [lines, setLines] = useState<TermLine[]>([
    { text: "oled playground — every tab runs the live backend.", tone: "dim" },
  ]);
  const [output, setOutput] = useState("// response bodies land here after a run");
  const [problems, setProblems] = useState<string[]>([]);
  const [audio, setAudio] = useState<{ url: string; meta: string } | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const termRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refreshVoices();
  }, [refreshVoices]);

  // Deep links from /docs ("Open in Playground"): ?endpoint=&lang=&
  // transport=&text=. Applied once on mount, before the first run.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const e = q.get("endpoint");
    const l = q.get("lang");
    const t = q.get("transport");
    const tx = q.get("text");
    if (e === "health" || e === "voices" || e === "speech") setEndpoint(e);
    if (l === "curl" || l === "javascript" || l === "python" || l === "sdk") setLang(l);
    if (t === "https" || t === "ws") setTransport(t);
    if (tx) setText(tx.slice(0, 2000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => cancelRef.current?.(), []);

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [lines, panel]);

  const base = gateway.base;
  const wsBase = base.replace(/^http/, "ws");
  const voices = (account?.voices ?? []).filter((v) => v.enabled);
  const voice = voices.find((v) => v.id === (voiceId || account?.defaultVoiceId)) ?? voices[0];
  const canStream = endpoint === "speech" && lang !== "curl";
  const wsMode = canStream && transport === "ws";
  const doc = ENDPOINT_DOCS[endpoint];

  const snippet = useMemo(() => {
    const ctx = { base, wsBase, text, voiceId: voice?.id ?? "ada" };
    return wsMode
      ? { code: buildWsSnippet(lang as Exclude<Lang, "curl">, ctx), editorLang: (lang === "javascript" ? "javascript" : "python") as "javascript" | "python" }
      : buildSnippet(lang, endpoint, ctx);
  }, [wsMode, lang, endpoint, base, wsBase, text, voice?.id]);

  useEffect(() => {
    if (!dirty) setCode(snippet.code);
  }, [snippet, dirty]);

  // Request swap: slide the editor in like flipping files.
  const pickEndpoint = (e: Endpoint) => {
    if (e === endpoint) return;
    setEndpoint(e);
    setDirty(false);
    setTransport("https");
    requestAnimationFrame(() => {
      if (!editorWrapRef.current) return;
      gsap.fromTo(
        editorWrapRef.current,
        { opacity: 0.15, x: 18 },
        { opacity: 1, x: 0, duration: 0.28, ease: "power2.out", overwrite: true }
      );
    });
  };

  if (!account) return null;

  const push = (l: TermLine) => {
    setLines((prev) => [...prev.slice(-299), l]);
    if (l.tone === "err") {
      setProblems((prev) => [...prev.slice(-19), l.text]);
    }
  };

  const playBlob = (blob: Blob, meta: string) => {
    const url = URL.createObjectURL(blob);
    setAudio({ url, meta });
    requestAnimationFrame(() => void audioRef.current?.play().catch(() => {}));
  };

  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD[lang].replace(/^[#/]+\s?/, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const run = async () => {
    if (running) return;
    cancelRef.current?.();
    setRunning(true);
    setAudio(null);
    setPanel("terminal");
    // What renders = what's TYPED in the editor (sidebar is the fallback).
    const fromEditor = endpoint === "speech" ? extractSpeech(code) : {};
    let speakText = (fromEditor.text ?? text).slice(0, 2000);
    const speakVoice = fromEditor.voiceId || voice?.id || "ada";
    // Free preview lane: capped, unbilled, trimmed — never billed by accident.
    const usePreview = endpoint === "speech" && preview;
    if (usePreview && speakText.length > 200) {
      speakText = speakText.slice(0, 200);
      push({ text: "preview lane trims to 200 free chars (toggle off for full billed render)", tone: "dim" });
    }
    const ctx = { base, wsBase, text: speakText, voiceId: speakVoice };
    push({ text: `$ ${cmdFor(lang, endpoint, ctx, wsMode)}`, tone: "cmd" });
    if (endpoint === "speech" && fromEditor.text !== undefined) {
      push({ text: `rendering ${speakText.length} chars from the editor · voice ${speakVoice}`, tone: "dim" });
    }

    let secret: string | null = null;
    if (endpoint === "speech") {
      secret = await ensureStudioSecret();
      if (!secret) {
        push({ text: "error: no Studio key — is the backend on :8000?", tone: "err" });
        setRunning(false);
        return;
      }
    }
    const started = Date.now();
    const ms = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

    try {
      if (endpoint === "health") {
        const h = await gateway.info();
        if (!h) {
          push({ text: "error: backend unreachable", tone: "err" });
          return;
        }
        const pretty = JSON.stringify(h, null, 2);
        setOutput(pretty);
        push({ text: pretty.split("\n").slice(0, 6).join("\n  "), tone: "ok" });
        push({ text: `200 OK · ${ms()} · full body in Output`, tone: "dim" });
        return;
      }
      if (endpoint === "voices") {
        const list = await gateway.voices();
        if (!list) {
          push({ text: "error: backend unreachable", tone: "err" });
          return;
        }
        setOutput(JSON.stringify(list, null, 2));
        for (const v of list.slice(0, 8)) push({ text: `${v.id} — ${v.label} (${v.accent})`, tone: "ok" });
        if (list.length > 8) push({ text: `… +${list.length - 8} more (see Output)`, tone: "dim" });
        push({ text: `${list.length} voices · ${ms()}`, tone: "dim" });
        return;
      }
      // speech — one real render of the EDITOR's text; costume per language
      const free = usePreview ? " · free preview — not billed" : "";
      if (wsMode) {
        const parts: BlobPart[] = [];
        let n = 0;
        const call = wsSpeak(
          speakText,
          (buf) => {
            parts.push(buf);
            n += 1;
            if (n === 1) push({ text: `connected · first audio after ${ms()}`, tone: "ok" });
            else if (n % 12 === 0) push({ text: `chunk ${n}…`, tone: "info" });
          },
          { voiceId: speakVoice, apiKey: secret ?? undefined, preview: usePreview }
        );
        cancelRef.current = call.cancel;
        const { bytes, firstChunkMs } = await call.done;
        cancelRef.current = null;
        playBlob(new Blob(parts, { type: "audio/wav" }), `live · ${(bytes / 1024).toFixed(0)}KB · first audio ${(firstChunkMs / 1000).toFixed(1)}s${free}`);
        setOutput(JSON.stringify({ bytes, chunks: n, first_audio_ms: firstChunkMs, voice: speakVoice }, null, 2));
        push({ text: `done: ${bytes} bytes in ${n} chunks · ${ms()}`, tone: "ok" });
        refreshBalance();
      } else {
        const parts: BlobPart[] = [];
        const call = speakHttp(speakText, (b) => parts.push(b), { voiceId: speakVoice, apiKey: secret ?? undefined, preview: usePreview });
        cancelRef.current = call.cancel;
        const { bytes, balanceChars } = await call.done;
        cancelRef.current = null;
        playBlob(new Blob(parts, { type: "audio/wav" }), `live · ${(bytes / 1024).toFixed(0)}KB · balance ${balanceChars ?? "?"}${free}`);
        setOutput(JSON.stringify({ bytes, voice: speakVoice, balance_chars: balanceChars }, null, 2));
        push({ text: `audio/wav · ${(bytes / 1024).toFixed(0)}KB · balance ${balanceChars ?? "?"} · ${ms()}`, tone: "ok" });
        refreshBalance();
      }
    } catch (e) {
      push({ text: `error: ${(e as Error).message}`, tone: "err" });
    } finally {
      setRunning(false);
      cancelRef.current = null;
    }
  };

  const openFile = (l: Lang) => {
    setLang(l);
    setDirty(false);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Playground</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-zinc-500">
            <Dot tone={health.online ? "green" : "red"} />
            {health.online ? `backend live · ${health.voices ?? 0} voices · every tab runs for real` : "backend unreachable — start it on :8000"}
          </p>
        </div>
      </header>

      {/* request tabs — the WHAT */}
      <div className="flex flex-wrap gap-2">
        {ENDPOINTS.map((e) => {
          const d = ENDPOINT_DOCS[e];
          const active = endpoint === e;
          return (
            <button
              key={e}
              onClick={() => pickEndpoint(e)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                active ? "border-ember/60 bg-ember/10 text-zinc-100" : "border-line bg-surface text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${d.method === "GET" ? "bg-green-500/15 text-green-400" : "bg-orange-500/15 text-orange-400"}`}>
                {d.method}
              </span>
              {d.path}
            </button>
          );
        })}
      </div>

      {/* install bar */}
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">install</span>
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300">{INSTALL_CMD[lang]}</code>
        <button onClick={copyInstall} className="shrink-0 font-mono text-[11px] text-zinc-500 hover:text-ember">
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>

      {/* ============ the VS Code window ============ */}
      <div className="overflow-hidden rounded-xl border border-line bg-[#1e1e1e]" style={CHROME_FONT}>
        {/* title bar */}
        <div className="flex items-center gap-3 border-b border-white/10 bg-[#323233] px-3 py-1">
          <span className="flex gap-1.5">
            <i className="size-2.5 rounded-full bg-[#ff5f57]" />
            <i className="size-2.5 rounded-full bg-[#febc2e]" />
            <i className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <p className="truncate text-[11px] text-zinc-400">
            oled-studio — {FILENAMES[lang]}
          </p>
          <span className="ml-auto flex items-center gap-2">
            {running && (
              <Button variant="ghost" size="sm" onClick={() => cancelRef.current?.()}>
                ■ Stop
              </Button>
            )}
            <Button size="sm" onClick={run} disabled={running || !health.online}>
              <IconPlay className="size-3" />
              {running ? "Running…" : "Run"}
            </Button>
          </span>
        </div>

        <div className="flex" style={{ minHeight: 380 }}>
          {/* activity rail */}
          <div className="flex w-10 shrink-0 flex-col items-center gap-0.5 border-r border-white/10 bg-[#333333] py-1.5">
            <button
              title="Explorer"
              onClick={() => setSideOpen((v) => !v)}
              className={`rounded p-1 ${sideOpen ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <IconFiles className="size-5" />
            </button>
            <button
              title="Terminal"
              onClick={() => setPanel("terminal")}
              className={`rounded p-1 ${panel === "terminal" ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <IconTerminal className="size-5" />
            </button>
            <button
              title="Problems"
              onClick={() => setPanel("problems")}
              className={`relative rounded p-1 ${panel === "problems" ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <IconWarn className="size-5" />
              {problems.length > 0 && (
                <i className="absolute right-0 top-0 flex size-3.5 items-center justify-center rounded-full bg-red-500 font-mono text-[8px] not-italic text-white">
                  {problems.length}
                </i>
              )}
            </button>
          </div>

          {/* sidebar */}
          {sideOpen && (
            <div className="w-44 shrink-0 overflow-y-auto border-r border-white/10 bg-[#252526] text-[12px]">
              <p className="px-3 pb-0.5 pt-2.5 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Explorer</p>
              <p className="px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">recipes</p>
              {LANGS.map((l) => {
                const Tile = FILE_ICON[l];
                return (
                  <button
                    key={l}
                    onClick={() => openFile(l)}
                    className={`flex w-full items-center gap-1.5 px-3 py-1 ${
                      lang === l ? "bg-[#37373d] text-white" : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <Tile />
                    <span className="font-mono text-[12px]">{FILENAMES[l]}</span>
                    {lang === l && dirty && <span className="ml-auto text-[10px] text-amber-400">●</span>}
                  </button>
                );
              })}
              <p className="px-3 pb-0.5 pt-3 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">inputs</p>
              <div className="space-y-1.5 px-2.5 pb-3">
                {endpoint === "speech" && (
                  <>
                    <Input
                      value={text}
                      onChange={(e) => setText(e.target.value.slice(0, 2000))}
                      placeholder="Fallback text…"
                      aria-label="Fallback text"
                      className="!h-7 !bg-[#1e1e1e] !text-xs"
                    />
                    {voices.length > 0 && (
                      <select
                        value={voice?.id ?? ""}
                        onChange={(e) => setVoiceId(e.target.value)}
                        aria-label="Fallback voice"
                        className="h-7 w-full rounded-md border border-line bg-[#1e1e1e] px-2 font-mono text-[11px] text-zinc-200"
                      >
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <p className="px-1 font-mono text-[10px] leading-snug text-zinc-600">
                      fallback only — Run speaks the editor text
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* editor + panel */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* editor tabs + transport */}
            <div className="flex items-stretch overflow-x-auto border-b border-white/10 bg-[#252526]">
              {LANGS.map((l) => {
                const Tile = FILE_ICON[l];
                return (
                  <button
                    key={l}
                    onClick={() => openFile(l)}
                    className={`flex shrink-0 items-center gap-1.5 border-r border-white/5 px-2.5 py-1.5 text-[12px] ${
                      lang === l ? "bg-[#1e1e1e] text-white" : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    <Tile />
                    {FILENAMES[l]}
                    {lang === l && dirty && <span className="text-[10px] text-amber-400">●</span>}
                  </button>
                );
              })}
              <span className="ml-auto flex shrink-0 items-center gap-2 px-2.5">
                <span className="hidden text-[11px] text-zinc-600 md:inline">
                  playground › {FILENAMES[lang]}
                </span>
                {canStream && (
                  <span className="flex rounded border border-white/10 p-0.5 font-mono text-[10px] uppercase">
                    {(["https", "ws"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => { setTransport(m); setDirty(false); }}
                        title={m === "ws" ? "WebSocket /v1/talk — chunked audio" : "HTTP /v1/speech — one WAV"}
                        className={`rounded px-2 py-0.5 ${transport === m ? "bg-ember font-bold text-black" : "text-zinc-500 hover:text-zinc-300"}`}
                      >
                        {m}
                      </button>
                    ))}
                  </span>
                )}
                {endpoint === "speech" && (
                  <button
                    onClick={() => setPreview((v) => !v)}
                    title={preview ? "Free preview: ≤200 chars, never billed" : "Full render: billed per character"}
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${
                      preview ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-white/10 text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {preview ? "preview · free" : "billed"}
                  </button>
                )}
              </span>
            </div>

            {/* editor */}
            <div ref={editorWrapRef} className="min-h-[260px] flex-1">
              <CodeEditor
                bare
                code={code}
                onChange={(v) => { setCode(v); setDirty(true); }}
                onCursor={(ln, col) => setCursor({ ln, col })}
                language={snippet.editorLang}
                filename={FILENAMES[lang]}
                badge={<span />}
              />
            </div>

            {/* bottom panel */}
            <div className="border-t border-white/10 bg-[#1e1e1e]">
              <div className="flex items-center gap-1 px-2 pt-0.5">
                {(["terminal", "output", "problems"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPanel(p)}
                    className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] ${
                      panel === p ? "text-white underline decoration-ember decoration-2 underline-offset-4" : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {p}{p === "problems" && problems.length > 0 && ` (${problems.length})`}
                  </button>
                ))}
                <button
                  onClick={() => { setLines([{ text: "cleared.", tone: "dim" }]); setProblems([]); }}
                  className="ml-auto px-2 font-mono text-[10px] text-zinc-600 hover:text-zinc-300"
                >
                  clear
                </button>
              </div>
              {panel === "terminal" && (
                <div ref={termRef} className="h-40 overflow-y-auto bg-[#0c0c0c] p-2.5 font-mono text-xs leading-5" style={EDITOR_FONT}>
                  {lines.map((l, i) => (
                    <p
                      key={i}
                      className={
                        l.tone === "cmd" ? "text-white"
                        : l.tone === "ok" ? "text-green-400"
                        : l.tone === "err" ? "text-red-400"
                        : l.tone === "info" ? "text-[#9cdcfe]"
                        : "text-zinc-600"
                      }
                    >
                      {l.tone === "cmd" ? l.text : `  ${l.text}`}
                    </p>
                  ))}
                  {running && <p className="animate-pulse text-ember">▊</p>}
                </div>
              )}
              {panel === "output" && (
                <pre className="h-40 overflow-auto whitespace-pre-wrap bg-[#0c0c0c] p-2.5 text-xs leading-5 text-[#9cdcfe]" style={EDITOR_FONT}>
                  {output}
                </pre>
              )}
              {panel === "problems" && (
                <div className="h-40 overflow-y-auto bg-[#0c0c0c] p-2.5 font-mono text-xs leading-5">
                  {problems.length === 0 ? (
                    <p className="text-zinc-600">No problems — last run was clean.</p>
                  ) : (
                    problems.map((p, i) => <p key={i} className="text-red-400">✕ {p}</p>)
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* status bar */}
        <div className="flex items-center gap-4 bg-[#0e639c] px-3 py-0.5 text-[11px] text-white" style={CHROME_FONT}>
          <span className="flex items-center gap-1.5">
            <Dot tone={health.online ? "green" : "red"} />
            {health.online ? "backend" : "offline"}
          </span>
          <span>Ln {cursor.ln}, Col {cursor.col}</span>
          <span className="hidden sm:inline">{LANG_LABEL[lang]}{canStream ? ` · ${transport}` : ""}</span>
          <span className="ml-auto">every tab runs live · UTF-8</span>
        </div>
      </div>

      {/* standard-doc continuation */}
      <Card>
        <CardHead
          title={doc.path}
          hint={doc.method}
          children={
            <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${doc.method === "GET" ? "bg-green-500/15 text-green-400" : "bg-orange-500/15 text-orange-400"}`}>
              {doc.method}
            </span>
          }
        />
        <div className="space-y-4 p-5 sm:p-6">
          <p className="text-sm leading-relaxed text-zinc-400">{doc.about}</p>
          {doc.params.length > 0 && (
            <div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">parameters</p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {doc.params.map((p) => (
                  <li key={p.name} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
                    <code className="shrink-0 font-mono text-xs text-ember">{p.name}</code>
                    <code className="shrink-0 font-mono text-[11px] text-zinc-500">{p.type}</code>
                    <span className="text-xs text-zinc-400">{p.desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line p-3.5">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">auth</p>
              <p className="text-xs leading-relaxed text-zinc-400">{doc.auth}</p>
            </div>
            <div className="rounded-lg border border-line bg-[#0c0c0c] p-3.5">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">response</p>
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[#9cdcfe]">{doc.response}</pre>
            </div>
          </div>
        </div>
      </Card>

      {/* audio out */}
      <Card>
        <CardHead title="Audio out" hint={audio ? audio.meta : "nothing rendered yet"} />
        <div className="p-5">
          {audio ? (
            <audio ref={audioRef} src={audio.url} controls className="w-full" />
          ) : (
            <p className="py-2 text-center text-sm text-zinc-600">Press Run — audio lands here.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
