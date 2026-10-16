import { useState } from "react";
import { Check, Copy, TerminalSquare } from "lucide-react";

const SNIPPETS: {
  id: string;
  label: string;
  raw: string;
  code: React.ReactNode;
}[] = [
  {
    id: "python",
    label: "Python",
    raw: `from oled_tts import OledClient\n\nclient = OledClient("http://127.0.0.1:8000")\njob = client.speak("owambe", "The party don start!")\nprint(job["job_id"])  # audio renders in seconds`,
    code: (
      <>
        <span className="text-ember">from</span> oled_tts{" "}
        <span className="text-ember">import</span> OledClient{"\n\n"}
        client = OledClient(
        <span className="text-gold">"http://127.0.0.1:8000"</span>){"\n"}
        job = client.speak(<span className="text-gold">"owambe"</span>,{" "}
        <span className="text-gold">"The party don start!"</span>){"\n"}
        <span className="text-ember">print</span>(job[
        <span className="text-gold">"job_id"</span>]){" "}
        <span className="text-dim"># audio renders in seconds</span>
      </>
    ),
  },
  {
    id: "curl",
    label: "cURL",
    raw: `curl -X POST localhost:8000/v1/tts -H 'Content-Type: application/json' -d '{"text":"Good morning Lagos"}' --output morning.wav`,
    code: (
      <>
        <span className="text-dim"># one line in, one recording out</span>
        {"\n"}
        curl -X POST localhost:8000/v1/tts \<span>{"\n"}</span>
        {"  "}-H{" "}
        <span className="text-gold">'Content-Type: application/json'</span> \
        <span>{"\n"}</span>
        {"  "}-d{" "}
        <span className="text-gold">
          '{"{"}"text":"Good morning Lagos"{"}"}'
        </span>{" "}
        --output morning.wav
      </>
    ),
  },
  {
    id: "scale",
    label: "Scale",
    raw: `OLED_MIN_WORKERS=10 modal deploy deploy/modal_app.py\n# or: docker compose up --scale worker=10`,
    code: (
      <>
        <span className="text-dim"># ten workers. or fifty. your call.</span>
        {"\n"}
        OLED_MIN_WORKERS=<span className="text-gold">10</span> modal deploy
        deploy/modal_app.py{"\n"}
        <span className="text-dim"># or self-hosted:</span>
        {"\n"}
        docker compose up --scale worker=<span className="text-gold">10</span>
      </>
    ),
  },
];

export function Developers() {
  const [tab, setTab] = useState("python");
  const [copied, setCopied] = useState(false);
  const active = SNIPPETS.find((s) => s.id === tab)!;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active.raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* noop */
    }
  };

  return (
    <section id="dev" className="mx-auto w-full max-w-6xl px-6 py-28 sm:py-36">
      <div className="grid items-center gap-12 md:grid-cols-2">
        <div>
          <p className="reveal font-mono text-[11px] uppercase tracking-[0.3em] text-ember">
            ／ Developers
          </p>
          <h2 className="reveal mt-4 font-display text-5xl font-bold tracking-tight sm:text-6xl">
            Three lines
            <br />
            to a voice.
          </h2>
          <p className="reveal mt-6 max-w-md text-sm leading-relaxed text-fog">
            No SDK to learn. HTTP in, audio out then scale the fleet with one
            environment variable.
          </p>
        </div>
        <div className="reveal overflow-hidden rounded-2xl border border-line bg-black shadow-[0_0_100px_-30px_rgba(255,92,10,0.5)]">
          <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
            <div className="flex items-center gap-2">
              <TerminalSquare className="h-4 w-4 text-ember" />
              <div className="flex gap-1.5">
                {SNIPPETS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setTab(s.id)}
                    className={`rounded-full px-4 py-1.5 font-mono text-xs transition-all ${
                      tab === s.id
                        ? "bg-ember text-black font-bold"
                        : "text-dim hover:text-white"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={copy}
              className="flex items-center gap-1.5 font-mono text-xs text-dim hover:text-white"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-ember" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "copied" : "copy"}
            </button>
          </div>
          <pre className="min-h-[190px] overflow-x-auto p-6 font-mono text-[13px] leading-[1.9]">
            <code key={tab}>{active.code}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
