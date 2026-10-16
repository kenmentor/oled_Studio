const STATS = [
  { v: "0.2", dec: 1, suffix: "s", label: "FIRST AUDIO" },
  { v: "24", dec: 0, suffix: "kHz", label: "STUDIO GRADE" },
  { v: "429", dec: 0, suffix: "→pool", label: "NEVER AN ERROR" },
  { v: "3", dec: 0, suffix: "→N", label: "PODS, NO CEILING" },
];

export function Numbers() {
  return (
    <section id="numbers" className="border-y border-white/5 bg-panel/60">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-2 md:grid-cols-4">
        {STATS.map((s, i) => (
          <div
            key={s.label}
            className={`reveal px-8 py-12 text-center ${i > 0 ? "border-l border-white/5" : ""}`}
          >
            <p className="font-display text-5xl font-bold tracking-tight sm:text-6xl">
              <span className="count" data-to={s.v} data-dec={s.dec}>
                0
              </span>
              <span className="text-ember">{s.suffix}</span>
            </p>
            <p className="mt-3 font-mono text-[10px] tracking-[0.3em] text-dim">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
