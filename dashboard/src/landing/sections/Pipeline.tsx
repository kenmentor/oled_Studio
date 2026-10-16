import { ArrowRight } from "lucide-react";

const STOPS = [
  {
    n: "01",
    t: "YOU TYPE",
    d: "A sentence, a script, a saga. Plain text is the entire interface — app, API, or studio.",
    tag: "INPUT",
  },
  {
    n: "02",
    t: "GATEWAY SERVES",
    d: "One FastAPI gateway validates the key, picks the voice, and renders inline in ~0.5s.",
    tag: "GATEWAY",
  },
  {
    n: "03",
    t: "QWEN POOL RENDERS",
    d: "Pooled Qwen voices render Nigerian English at 24kHz. Scales on Modal, idles to zero.",
    tag: "QWEN",
  },
  {
    n: "04",
    t: "WAV STREAMS",
    d: "Audio leaves as WAV over HTTP, SSE, or live WebSocket chunks. First audio in ~0.2s.",
    tag: "WAV",
  },
  {
    n: "05",
    t: "EARS RECEIVE",
    d: "WAV straight to a player, or into your app over WebSocket. Journey complete.",
    tag: "OUTPUT",
  },
];

export function Pipeline() {
  return (
    <section
      id="flow"
      className="hwrap relative overflow-hidden border-y border-white/5 bg-panel/50"
    >
      <div className="htrack flex h-screen w-max items-center gap-6 px-6 sm:px-16">
        <div className="w-[80vw] shrink-0 sm:w-[32vw]">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ember">
            ／ The machine
          </p>
          <h2 className="mt-4 font-display text-5xl font-bold leading-[1.02] tracking-tight sm:text-7xl">
            KEEP
            <br />
            SCROLLING<span className="text-ember">.</span>
          </h2>
          <p className="mt-6 max-w-xs text-sm leading-relaxed text-fog">
            The page is pinned. The pipeline moves. Five stops from keystroke to
            soundwave.
          </p>
        </div>
        {STOPS.map((s) => (
          <article
            key={s.n}
            className="card-sheen flex h-[62vh] w-[82vw] shrink-0 flex-col justify-between rounded-3xl border border-line bg-card p-8 sm:w-[38vw] sm:p-12"
          >
            <div className="flex items-start justify-between">
              <span className="font-display text-7xl font-bold text-white/10">
                {s.n}
              </span>
              <span className="rounded-full border border-ember/40 bg-ember/10 px-3 py-1 font-mono text-[10px] tracking-[0.25em] text-ember">
                {s.tag}
              </span>
            </div>
            <div>
              <h3 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
                {s.t}
              </h3>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-fog">
                {s.d}
              </p>
            </div>
            <ArrowRight className="h-6 w-6 text-ember" />
          </article>
        ))}
        <div className="flex w-[60vw] shrink-0 items-center justify-center sm:w-[24vw]">
          <a
            href="/studio"
            className="magnetic rounded-full bg-ember px-10 py-5 font-display text-xl font-bold text-black shadow-[0_0_80px_rgba(255,92,10,0.5)]"
          >
            RIDE IT →
          </a>
        </div>
      </div>
    </section>
  );
}
