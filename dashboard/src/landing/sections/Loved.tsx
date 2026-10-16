import { Star } from "lucide-react";

const QUOTES = [
  { q: "It pronounced my grandmother's name correctly on the first try.", n: "Amara", r: "Storyteller" },
  { q: "Our jingles finally sound like us.", n: "Tunde", r: "Producer, Lagos" },
  { q: "The Igbo intonation is spot on — my callers stay on the line.", n: "Jonas", r: "Backend engineer" },
  { q: "Dropped the speech API into our app in an afternoon.", n: "Priya", r: "Game dev" },
  { q: "First audio lands before I lift my finger off play.", n: "Ada", r: "Studio user" },
  { q: "My students lean in when Adaeze speaks.", n: "Mrs. Okafor", r: "Teacher, Abuja" },
];

function Row({ items, rev }: { items: typeof QUOTES; rev?: boolean }) {
  const row = [...items, ...items];
  return (
    <div className="mask-fade-x overflow-hidden">
      <div className={`animate-marquee flex w-max gap-5 pr-5 hover:[animation-play-state:paused] ${rev ? "marquee-rev animate-marquee-fast" : ""}`}>
        {row.map((t, i) => (
          <figure key={i} className="card-sheen w-80 shrink-0 rounded-2xl border border-line bg-card p-6 text-left">
            <div className="flex gap-1">
              {Array.from({ length: 5 }).map((_, j) => (
                <Star key={j} className="h-3 w-3 fill-ember text-ember" />
              ))}
            </div>
            <blockquote className="mt-4 text-[15px] leading-relaxed">“{t.q}”</blockquote>
            <figcaption className="mt-4 font-mono text-[11px] text-dim">
              {t.n} <span className="text-fog">· {t.r}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

export function Loved() {
  return (
    <section id="loved" className="overflow-hidden py-28 sm:py-36">
      <div className="mx-auto w-full max-w-7xl px-6">
        <p className="reveal font-mono text-[11px] uppercase tracking-[0.3em] text-ember">／ Word of mouth</p>
        <h2 className="reveal mt-4 max-w-2xl font-display text-5xl font-bold tracking-tight sm:text-6xl">
          Loved where
          <br />
          it matters.
        </h2>
      </div>
      <div className="mt-14 space-y-5">
        <Row items={QUOTES.slice(0, 3)} />
        <Row items={QUOTES.slice(3)} rev />
      </div>
    </section>
  );
}
