const TEXT =
  "Every synthetic voice sounds like somewhere else. Ours pronounces Owambe correctly. It knows no wahala is a full sentence. It carries the rhythm of home  Lagos traffic, Abuja mornings, Port Harcourt nights  in every single line.".split(
    " ",
  );

export function Manifesto() {
  return (
    <section
      id="manifesto"
      className="mx-auto w-full max-w-5xl px-6 py-32 sm:py-44"
    >
      <p className="reveal mb-8 font-mono text-[11px] uppercase tracking-[0.3em] text-ember">
        ／ The problem
      </p>
      <p className="scrub-words font-display text-3xl font-medium leading-[1.35] tracking-tight sm:text-5xl sm:leading-[1.3]">
        {TEXT.map((w, i) => (
          <span
            key={i}
            className={/Owambe|wahala|home/.test(w) ? "text-ember" : undefined}
          >
            {w}{" "}
          </span>
        ))}
      </p>
    </section>
  );
}
