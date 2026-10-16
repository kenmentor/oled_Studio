import { ArrowDown, ArrowUpRight, Play } from "lucide-react";
import { scrollToId } from "@/lib/anim";
import { Showcase } from "@/sections/Showcase";

export function Hero() {
  return (
    <header className="noise-bg relative overflow-hidden pt-16">
      <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-6 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
        {/*  copy: always on top, never overlapped  */}
        <div className="relative z-10">
          <h1 className="font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl xl:text-7xl">
            <span className="mask-line">
              <span>TYPE IT.</span>
            </span>
            <span className="mask-line">
              <span className="ember-glow text-ember">HEAR IT.</span>
            </span>
            <span className="mask-line">
              <span className="text-stroke">SOUND HOME.</span>
            </span>
          </h1>
          <p className="h-fade mt-8 max-w-lg text-base leading-relaxed text-fog sm:text-lg">
            Studio-grade Nigerian English from plain text instant for one
            listener, elastic for one hundred thousand. This is voice you
            deploy.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="/studio"
              className="magnetic inline-flex items-center gap-2 rounded-full bg-ember px-7 py-3.5 text-sm font-bold text-black shadow-[0_0_50px_rgba(255,92,10,0.4)]"
            >
              <Play className="h-4 w-4 fill-black" /> Start speaking
            </a>
            <button
              onClick={() => scrollToId("flow")}
              className="magnetic inline-flex items-center gap-2 rounded-full border border-line bg-panel px-7 py-3.5 text-sm font-semibold transition-colors hover:border-ember/60"
            >
              See the machine <ArrowUpRight className="h-4 w-4 text-ember" />
            </button>
          </div>
          <div className="h-fade mt-12 flex flex-wrap gap-x-10 gap-y-3 border-t border-white/5 pt-7 font-mono text-xs text-dim">
            <span>
              <b className="text-lg text-white">0.2s</b> first audio
            </span>
            <span>
              <b className="text-lg text-white">24kHz</b> studio grade
            </span>
            <span>
              <b className="text-lg text-white">∞</b> pool scale
            </span>
          </div>
        </div>

        {/*  cinematic: its own column, its own light  */}
        <div className="relative z-0" data-speed="0.92">
          <div className="pointer-events-none absolute -inset-10 bg-[radial-gradient(ellipse_60%_60%_at_50%_45%,rgba(255,92,10,0.13),transparent_70%)]" />
          <div className="h-fade relative h-[340px] sm:h-[380px] lg:h-[440px]">
            <Showcase />
          </div>
        </div>
      </div>

      <button
        onClick={() => scrollToId("manifesto")}
        className="h-fade relative mx-auto mb-8 flex flex-col items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-dim"
      >
        scroll
        <ArrowDown className="h-4 w-4 animate-bounce text-ember" />
      </button>
    </header>
  );
}
