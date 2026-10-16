"use client";

/* A VS Code-flavored code box with zero dependencies: syntax-highlighted
 * overlay under a transparent textarea (single source of truth), line
 * numbers, Tab-to-spaces, and a Ctrl+Space autocomplete popup fed by
 * completeFor(). Editing is for learning/copy-paste — Run always executes
 * the built request, never this text. */

import { useEffect, useMemo, useRef, useState } from "react";
import { completeFor } from "@/lib/playground";

type HL = "bash" | "javascript" | "python";

const KEYWORDS: Record<HL, string[]> = {
  bash: ["curl", "echo", "if", "then", "fi", "for", "in", "do", "done"],
  javascript: [
    "const", "let", "var", "await", "async", "new", "for", "of", "if", "else",
    "return", "throw", "typeof", "process", "console",
  ],
  python: [
    "import", "from", "for", "in", "print", "open", "if", "else", "return",
    "raise", "with", "as", "f",
  ],
};

/* VS Code's editor type: Consolas 14px, ~19px rows. The chrome around it
 * (tabs, terminal, status) uses the system stack like the real thing. */
export const EDITOR_FONT = { fontFamily: "Consolas, 'Courier New', monospace", fontSize: 14, lineHeight: "19px" } as const;
export const CHROME_FONT = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', sans-serif",
} as const;

export function highlight(code: string, lang: HL): React.ReactNode[] {
  // Order matters: comments and strings first so keywords inside them stay dim.
  const re =
    lang === "bash"
      ? /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(--?[a-zA-Z-]+)|\b(\d+(?:\.\d+)?)\b|\b(curl|echo)\b/g
      : lang === "python"
        ? /(#[^\n]*)|("""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\bf(["'])(?:[^\\]|\\.)*?\2|\b(\d+(?:\.\d+)?)\b|\b(import|from|for|in|print|open|if|else|return|raise|with|as)\b/g
        : /(\/\/[^\n]*)|(`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\b(\d+(?:\.\d+)?)\b|\b(const|let|var|await|async|new|for|of|if|else|return|throw|typeof)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  const cls = (t: string) => {
    if (!t) return "";
    if (/^(#|\/\/)/.test(t)) return "text-[#6a9955] italic";
    if (/^["'`]/.test(t) || (lang === "python" && /^f["']/.test(t))) return "text-[#ce9178]";
    if (/^\d/.test(t)) return "text-[#b5cea8]";
    if (/^--?/.test(t)) return "text-[#9cdcfe]";
    if (KEYWORDS[lang].includes(t)) return "text-[#c586c0]";
    return "text-[#dcdcaa]"; // function call
  };
  re.lastIndex = 0;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push(<span key={k++}>{code.slice(last, m.index)}</span>);
    const tok = m[0];
    // Decide which alternative matched: find the non-undefined group.
    const colored = m[1] !== undefined || m[2] !== undefined || m[3] !== undefined || m[4] !== undefined || m[5] !== undefined;
    out.push(
      <span key={k++} className={colored ? cls(tok) : undefined}>
        {tok}
      </span>
    );
    last = m.index + tok.length;
    if (tok.length === 0) re.lastIndex++;
  }
  if (last < code.length) out.push(<span key={k++}>{code.slice(last)}</span>);
  return out;
}

export default function CodeEditor({
  code,
  onChange,
  language,
  filename,
  badge,
  onReset,
  bare = false,
  onCursor,
}: {
  code: string;
  onChange: (v: string) => void;
  language: HL;
  filename: string;
  badge: React.ReactNode;
  onReset?: () => void;
  /** bare: embed in a bigger VS Code window (no title/status bar). */
  bare?: boolean;
  onCursor?: (ln: number, col: number) => void;
}) {
  const [cursor, setCursor] = useState({ ln: 1, col: 1 });
  const [suggest, setSuggest] = useState<{ open: boolean; items: { name: string; detail: string }[]; index: number }>({
    open: false,
    items: [],
    index: 0,
  });
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const lines = useMemo(() => code.split("\n").length, [code]);

  const syncCursor = () => {
    const ta = taRef.current;
    if (!ta) return;
    const upto = ta.value.slice(0, ta.selectionStart).split("\n");
    const pos = { ln: upto.length, col: upto[upto.length - 1].length + 1 };
    setCursor(pos);
    onCursor?.(pos.ln, pos.col);
  };

  const onScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  const currentWord = () => {
    const ta = taRef.current;
    if (!ta) return "";
    const before = ta.value.slice(0, ta.selectionStart);
    return (before.match(/[A-Za-z0-9_$-]+$/) || [""])[0];
  };

  const openSuggest = (filter = "") => {
    const items = completeFor(language).filter((i) =>
      i.name.toLowerCase().startsWith(filter.toLowerCase())
    );
    setSuggest({ open: true, items: items.length ? items : completeFor(language), index: 0 });
  };

  const insert = (name: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const w = currentWord();
    const pos = ta.selectionStart;
    const next = ta.value.slice(0, pos - w.length) + name + ta.value.slice(pos);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const at = pos - w.length + name.length;
      ta.setSelectionRange(at, at);
      syncCursor();
    });
    setSuggest((s) => ({ ...s, open: false }));
  };

  useEffect(() => {
    if (!suggest.open) return;
    const close = () => setSuggest((s) => ({ ...s, open: false }));
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [suggest.open ]);

  const tokens = useMemo(() => highlight(code, language), [code, language]);

  return (
    <div className={`overflow-hidden ${bare ? "bg-[#1e1e1e]" : "rounded-xl border border-line bg-[#1e1e1e]"}`}>
      {/* title bar */}
      {!bare && (
        <div className="flex items-center gap-2 border-b border-white/10 bg-[#252526] px-3 py-2">
          <span className="flex gap-1.5">
            <i className="size-2.5 rounded-full bg-[#ff5f57]" />
            <i className="size-2.5 rounded-full bg-[#febc2e]" />
            <i className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="ml-1 font-mono text-[11px] text-zinc-400">{filename}</span>
          <span className="ml-auto flex items-center gap-2">
            {onReset && (
              <button onClick={onReset} className="font-mono text-[10px] text-zinc-500 hover:text-ember">
                reset
              </button>
            )}
            {badge}
          </span>
        </div>
      )}
      {/* body */}
      <div className="relative flex" style={EDITOR_FONT}>
        <div aria-hidden className="select-none py-2 pl-3 pr-2 text-right text-zinc-600" style={EDITOR_FONT}>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <pre
            ref={preRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre py-2 pr-3"
            style={EDITOR_FONT}
          >
            <code className="text-[#d4d4d4]">
              {tokens}
              {code.endsWith("\n") ? "\n" : null}
            </code>
          </pre>
          <textarea
            ref={taRef}
            value={code}
            onChange={(e) => {
              onChange(e.target.value);
              setSuggest((s) => ({ ...s, open: false }));
            }}
            onScroll={onScroll}
            onSelect={syncCursor}
            onKeyUp={syncCursor}
            onClick={syncCursor}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            onKeyDown={(e) => {
              if (suggest.open) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSuggest((s) => ({ ...s, index: (s.index + 1) % s.items.length }));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSuggest((s) => ({ ...s, index: (s.index - 1 + s.items.length) % s.items.length }));
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  insert(suggest.items[suggest.index].name);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSuggest((s) => ({ ...s, open: false }));
                  return;
                }
              }
              if (e.key === "Tab") {
                e.preventDefault();
                const ta = taRef.current!;
                const s = ta.selectionStart;
                onChange(code.slice(0, s) + "  " + code.slice(ta.selectionEnd));
                requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2));
              } else if (e.key === " " && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                openSuggest(currentWord());
              }
            }}
            className="relative block w-full resize-none overflow-auto bg-transparent py-2 pr-3 text-transparent caret-[#aeafad] outline-none selection:bg-[#264f78] selection:text-transparent"
            style={{ minHeight: 266, ...EDITOR_FONT }}
          />
          {suggest.open && (
            <div className="absolute left-8 top-10 z-20 w-72 overflow-hidden rounded-md border border-white/15 bg-[#252526] shadow-2xl">
              {suggest.items.map((it, i) => (
                <button
                  key={it.name}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insert(it.name);
                  }}
                  onMouseEnter={() => setSuggest((s) => ({ ...s, index: i }))}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11px] ${
                    i === suggest.index ? "bg-[#04395e] text-white" : "text-zinc-300"
                  }`}
                >
                  <span className="shrink-0 rounded bg-ember/20 px-1 text-ember">◈</span>
                  <span className="truncate">{it.name}</span>
                  <span className="ml-auto truncate pl-2 text-[10px] text-zinc-500">{it.detail}</span>
                </button>
              ))}
              <p className="border-t border-white/10 px-2.5 py-1 font-mono text-[10px] text-zinc-600">
                ↑↓ navigate · enter insert · esc close
              </p>
            </div>
          )}
        </div>
      </div>
      {/* status bar */}
      {!bare && (
        <div className="flex items-center gap-3 border-t border-white/10 bg-[#0e639c] px-3 py-1 font-mono text-[10px] text-white">
          <span>
            Ln {cursor.ln}, Col {cursor.col}
          </span>
          <span className="ml-auto">{language === "bash" ? "Shell" : language === "python" ? "Python" : "JavaScript"}</span>
          <span>UTF-8</span>
          <span>Ctrl+Space ÷ complete</span>
        </div>
      )}
    </div>
  );
}
