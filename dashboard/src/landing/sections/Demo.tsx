import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { GW } from "@/lib/anim";

const SCENES = [
  {
    id: "morning",
    title: "Good morning, Lagos",
    script:
      "Good morning Lagos. Danfo don dey road, sun don rise, and today go good. This na Adaeze, and I dey here to read your day to you.",
  },
  {
    id: "story",
    title: "Tortoise & the drum",
    script:
      "Long ago, when the rivers still sang, Tortoise found a drum that spoke. He tapped it once, and the whole village gathered to listen.",
  },
  {
    id: "owambe",
    title: "Owambe invitation",
    script:
      "You are invited! This Saturday, for Amara's naming ceremony. Come chop rice, come dance, come celebrate with us. No African time!",
  },
];

export function Demo() {
  const [scene, setScene] = useState(SCENES[0]);
  const [text, setText] = useState(SCENES[0].script);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const pick = (id: string) => {
    const s = SCENES.find((x) => x.id === id)!;
    setScene(s);
    setText(s.script);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext("2d")!;
    const data = new Uint8Array(64);
    let raf = 0;
    const start = performance.now();
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const W = (canvas.width = canvas.offsetWidth * 2);
      const H = (canvas.height = 130);
      g.clearRect(0, 0, W, H);
      const bars = 72;
      const bw = W / bars;
      const live = analyserRef.current && !audioRef.current?.paused;
      if (live) analyserRef.current!.getByteFrequencyData(data);
      for (let i = 0; i < bars; i++) {
        let v: number;
        if (live) {
          v = data[Math.floor((i / bars) * 48)] / 255;
        } else {
          const t = (performance.now() - start) / 1000;
          v = 0.05 + 0.04 * Math.sin(t * 1.4 + i * 0.35);
        }
        const h = Math.max(4, v * H);
        const grad = g.createLinearGradient(0, H - h, 0, H);
        grad.addColorStop(0, "#ffb37a");
        grad.addColorStop(1, "#a33c06");
        g.fillStyle = live ? grad : "#232326";
        const x = i * bw + bw * 0.22;
        g.beginPath();
        g.roundRect(x, H - h, bw * 0.56, h, 5);
        g.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    a.addEventListener("play", on);
    a.addEventListener("pause", off);
    a.addEventListener("ended", off);
    return () => {
      a.removeEventListener("play", on);
      a.removeEventListener("pause", off);
      a.removeEventListener("ended", off);
    };
  }, []);

  const ensureGraph = () => {
    try {
      if (!ctxRef.current) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        ctxRef.current = new AC();
      }
      if (!analyserRef.current && audioRef.current) {
        const src = ctxRef.current.createMediaElementSource(audioRef.current);
        analyserRef.current = ctxRef.current.createAnalyser();
        analyserRef.current.fftSize = 128;
        src.connect(analyserRef.current);
        analyserRef.current.connect(ctxRef.current.destination);
      }
      void ctxRef.current.resume();
    } catch {
      /* visualizer optional */
    }
  };

  const run = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      ensureGraph();
      const r = await fetch(`${GW}/v1/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim().slice(0, 500) }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (url) URL.revokeObjectURL(url);
      const next = URL.createObjectURL(await r.blob());
      setUrl(next);
      requestAnimationFrame(() => audioRef.current?.play().catch(() => {}));
    } catch (e) {
      setErr(
        `Studio offline  run start-all.bat first. (${(e as Error).message})`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="demo"
      className="noise-bg mx-auto w-full max-w-5xl px-6 py-28 sm:py-36"
    >
      <p className="reveal text-center font-mono text-[11px] uppercase tracking-[0.3em] text-ember">
        ／ The journey
      </p>
      <h2 className="reveal mx-auto mt-4 max-w-2xl text-center font-display text-5xl font-bold tracking-tight sm:text-6xl">
        Pick a moment.
        <br />
        Press play.
      </h2>

      <div className="reveal mt-10 flex flex-wrap justify-center gap-2">
        {SCENES.map((s) => (
          <button
            key={s.id}
            onClick={() => pick(s.id)}
            className={`rounded-full border px-5 py-2 text-sm transition-all ${
              scene.id === s.id
                ? "border-ember bg-ember/15 text-ember shadow-[0_0_30px_rgba(255,92,10,0.25)]"
                : "border-line bg-panel text-fog hover:text-white"
            }`}
          >
            {s.title}
          </button>
        ))}
      </div>

      <div
        className={`reveal card-sheen mt-8 rounded-3xl border bg-card/80 p-6 backdrop-blur transition-shadow sm:p-10 ${
          playing
            ? "border-ember/60 shadow-[0_0_90px_-18px_rgba(255,92,10,0.7)]"
            : "border-line"
        }`}
      >
        <canvas ref={canvasRef} className="h-[65px] w-full" />
        <p
          className={`mt-6 font-display text-2xl font-medium leading-snug sm:text-3xl ${playing ? "" : "text-fog"}`}
        >
          {text || "…"}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={500}
          className="mt-6 w-full resize-none rounded-xl border border-line bg-void px-4 py-3 text-sm outline-none placeholder:text-dim focus:border-ember/60"
          placeholder="…or write your own line"
        />
        <div className="mt-4 flex items-center justify-between">
          <span className="font-mono text-[11px] text-dim">
            {text.length}/500
          </span>
          <button
            onClick={run}
            disabled={busy || !text.trim()}
            className="magnetic inline-flex items-center gap-2 rounded-full bg-ember px-8 py-3 text-sm font-bold text-black shadow-[0_0_40px_rgba(255,92,10,0.4)] disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Rendering…" : "Speak it"}
          </button>
        </div>
        {err && <p className="mt-3 text-xs text-red-400">{err}</p>}
        <audio
          ref={audioRef}
          src={url ?? undefined}
          className="mt-4 w-full"
          controls
        />
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="noise-bg overflow-hidden border-t border-white/5">
      <div className="mx-auto w-full max-w-7xl px-6 pb-10 pt-24 text-center sm:pt-32">
        <p className="reveal font-mono text-[11px] uppercase tracking-[0.3em] text-ember">
          ／ Last call
        </p>
        <h2 className="reveal mx-auto mt-6 max-w-4xl font-display text-6xl font-bold leading-[0.95] tracking-tight sm:text-8xl">
          GIVE YOUR
          <br />
          PRODUCT A<br />
          <span className="ember-glow text-ember">HOMELAND.</span>
        </h2>
        <div className="reveal mt-12 flex flex-wrap justify-center gap-4">
          <a
            href="/studio"
            className="magnetic rounded-full bg-ember px-10 py-4 font-display text-lg font-bold text-black shadow-[0_0_80px_rgba(255,92,10,0.5)]"
          >
            Open the studio
          </a>
          <a
            href="/docs"
            className="magnetic rounded-full border border-line bg-panel px-10 py-4 font-display text-lg font-bold transition-colors hover:border-ember/60"
          >
            Read the API
          </a>
        </div>
        <div className="mt-24 flex flex-col items-center justify-between gap-6 border-t border-white/5 pt-8 sm:flex-row">
          <img src="/logo.png" alt="OLED Studio" className="h-8 w-auto" />
          <span className="font-mono text-[11px] text-dim">LAGOS · ABUJA · PH · EVERYWHERE</span>
        </div>
      </div>
    </footer>
  );
}
