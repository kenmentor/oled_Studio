import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const VOICES = [
  {
    name: "ADAEZE",
    tag: "Warm · Clear",
    desc: "Announcements, classrooms, customer care. The voice of patience — she slows down for every name.",
    use: "EDU / IVR / CARE",
    grad: "from-ember/25",
  },
  {
    name: "EMEKA",
    tag: "Deep · Steady",
    desc: "Storytelling, ads, narration. Unhurried confidence with the weight of evening radio.",
    use: "ADS / FILM / BOOKS",
    grad: "from-gold/20",
  },
  {
    name: "FUNMI",
    tag: "Bright · Quick",
    desc: "Creators, skits, social. A smile you can hear — built for timelines that never sleep.",
    use: "CREATORS / SOCIAL",
    grad: "from-emberdim/25",
  },
];

export function Voices() {
  useEffect(() => {
    const cards = gsap.utils.toArray<HTMLElement>(".stack-card");
    cards.forEach((card, i) => {
      if (i === cards.length - 1) return;
      gsap.to(card, {
        scale: 0.92,
        opacity: 0.55,
        filter: "blur(2px)",
        ease: "none",
        scrollTrigger: { trigger: cards[i + 1], start: "top bottom", end: "top top+=120", scrub: true },
      });
    });
    return () => ScrollTrigger.getAll().forEach((t) => {
      if (t.trigger && (t.trigger as HTMLElement).classList?.contains("stack-card")) t.kill();
    });
  }, []);

  return (
    <section id="voices" className="mx-auto w-full max-w-6xl px-6 py-28">
      <p className="reveal font-mono text-[11px] uppercase tracking-[0.3em] text-ember">／ The voices</p>
      <h2 className="reveal mt-4 max-w-2xl font-display text-5xl font-bold tracking-tight sm:text-6xl">
        Three voices.
        <br />
        One homeland.
      </h2>
      <div className="mt-16 space-y-6">
        {VOICES.map((v, i) => (
          <article
            key={v.name}
            className={`stack-card card-sheen sticky rounded-3xl border border-line bg-gradient-to-b ${v.grad} to-card p-8 sm:p-12`}
            style={{ top: `${96 + i * 28}px` }}
          >
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-xs tracking-[0.25em] text-ember">0{i + 1} — {v.tag}</p>
                <h3 className="mt-3 font-display text-6xl font-bold tracking-tight sm:text-8xl">{v.name}</h3>
              </div>
              <p className="max-w-sm text-sm leading-relaxed text-fog">{v.desc}</p>
            </div>
            <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-6">
              <span className="font-mono text-[11px] tracking-[0.25em] text-dim">{v.use}</span>
              <a href="http://localhost:5173" className="magnetic font-mono text-xs uppercase tracking-widest text-ember">
                audition →
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
