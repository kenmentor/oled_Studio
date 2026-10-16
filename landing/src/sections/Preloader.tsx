import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

export function Preloader({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const obj = { v: 0 };
    const tween = gsap.to(obj, {
      v: 100,
      duration: 1.6,
      ease: "power2.inOut",
      onUpdate: () => setN(Math.round(obj.v)),
      onComplete: () => {
        if (done.current) return;
        done.current = true;
        gsap.to(root.current, {
          yPercent: -100,
          duration: 0.9,
          ease: "power4.inOut",
          delay: 0.15,
          onComplete: onDone,
        });
      },
    });
    return () => {
      tween.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={root} className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-void">
      <img src="/logo.png" alt="OLED Studio" className="h-11 w-auto" />
      <p className="mt-8 font-display text-8xl font-bold tabular-nums tracking-tight">
        {n}
        <span className="text-ember">%</span>
      </p>
      <div className="mt-6 h-px w-56 overflow-hidden bg-line">
        <div className="h-full origin-left bg-ember" style={{ transform: `scaleX(${n / 100})` }} />
      </div>
      <p className="mt-4 font-mono text-[11px] text-dim">warming up the voices…</p>
    </div>
  );
}
