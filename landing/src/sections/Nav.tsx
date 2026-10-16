import { scrollToId } from "@/lib/anim";

export function Nav() {
  return (
    <>
      <div className="progress fixed inset-x-0 top-0 z-[95] h-[2px] origin-left scale-x-0 bg-ember" />
      <nav className="fixed inset-x-0 top-0 z-[94] border-b border-white/5 bg-void/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex items-center"
            aria-label="OLED Studio home"
          >
            <img src="/logo.png" alt="OLED Studio" className="h-14 w-auto" />
          </button>
          <div className="hidden items-center gap-8 font-mono text-[11px] uppercase tracking-[0.2em] text-fog lg:flex">
            {[
              ["Voices", "voices"],
              ["Pipeline", "flow"],
              ["Developers", "dev"],
              ["Proof", "loved"],
            ].map(([label, id]) => (
              <button
                key={id}
                onClick={() => scrollToId(id)}
                className="transition-colors hover:text-white"
              >
                {label}
              </button>
            ))}
          </div>
          <a
            href="http://localhost:5173"
            className="magnetic rounded-full bg-ember px-5 py-2 text-sm font-semibold text-black shadow-[0_0_30px_rgba(255,92,10,0.35)]"
          >
            Open studio
          </a>
        </div>
      </nav>
    </>
  );
}
