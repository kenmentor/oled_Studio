import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Mic, PhoneOff, Play, Video, Volume2 } from "lucide-react";
import { GW } from "@/lib/anim";

/**
 * Cinematic product loop:
 *   1. TYPE  real highlighted code writes itself (static camera, breathing frame)
 *   2. STRIKE  cursor lands pixel-exact on Run, thud + ripple, status prints
 *   3. FLIP  one continuous 3D turn into the player
 *   4. WAVE RIDES  the REAL voice plays; a TRUE waveform (decoded peaks,
 *      speech dynamics, not sine) sweeps with progress
 *   5. METAMORPHOSIS  the player becomes a phone call, step by step:
 *      bezel + notch draw in → status bar drops → avatar rises with a LIVING
 *      wave-ring → name, timer, controls stagger home → the call breathes
 *   6. REWIND  hang up, melt back to the player, flip home, wipe, loop
 */
const LINES = [
  "from oled_tts import OledClient",
  "",
  'client = OledClient("http://127.0.0.1:8000")',
  'job = client.speak("owambe", "The party don start!")',
  'print(job["job_id"])',
];

const TRANSCRIPT =
  "Come chop rice, come dance, come celebrate with us. No African time!";
const NCOLS = 140;

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hi(line: string) {
  if (!line) return "";
  const re =
    /(#[^\n]*)|("[^"\n]*"?|'[^'\n]*'?)|\b(from|import|print|as|return|def|None|True|False|with|for|in)\b|\b(\d[\d.]*)\b|([A-Za-z_][\w]*)(?=\()|([()\[\]{},.:=])/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out += esc(line.slice(last, m.index));
    const [tok, com, str, kw, num, fn, punc] = m;
    if (com) out += `<span class="tok-com">${esc(tok)}</span>`;
    else if (str) out += `<span class="tok-str">${esc(tok)}</span>`;
    else if (kw) out += `<span class="tok-kw">${esc(tok)}</span>`;
    else if (num) out += `<span class="tok-num">${esc(tok)}</span>`;
    else if (fn) out += `<span class="tok-fn">${esc(tok)}</span>`;
    else if (punc) out += `<span class="tok-punc">${esc(tok)}</span>`;
    last = m.index + tok.length;
  }
  return out + esc(line.slice(last));
}

/** Speech-like envelope: bursts and breaths, never a sine. */
function proceduralPeaks(n: number): Float32Array {
  const p = new Float32Array(n);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const bursts = Array.from({ length: 9 }, () => ({
    c: rnd() * n,
    w: 4 + rnd() * 14,
    h: 0.5 + rnd() * 0.5,
  }));
  for (let i = 0; i < n; i++) {
    let v = 0.05;
    for (const b of bursts) {
      const d = (i - b.c) / b.w;
      v += b.h * Math.exp(-d * d);
    }
    v += rnd() * 0.1; // room noise  real recordings are never silent
    p[i] = Math.min(1, v);
  }
  return p;
}

export function Showcase() {
  const root = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobRef = useRef<string | null>(null);
  const fetchRef = useRef<Promise<string | null> | null>(null);
  const peaksRef = useRef<Float32Array>(proceduralPeaks(NCOLS));
  const flippedRef = useRef(false);
  const inCallRef = useRef(false);
  const everPlayedRef = useRef(false);
  const fakeP = useRef(0);
  const callStart = useRef(0);
  const [tapNeeded, setTapNeeded] = useState(false);

  //  master rAF: true wave + avatar ring + clocks
  useLayoutEffect(() => {
    let raf = 0;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    const data = new Uint8Array(64);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const el = root.current;
      if (!el) return;
      const now = performance.now();
      const a = audioRef.current;
      const live = !!(a && a.src && !a.paused && !a.ended);

      if (live && a) {
        try {
          if (!ctx) {
            const AC =
              window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext })
                .webkitAudioContext;
            ctx = new AC();
            const src = ctx.createMediaElementSource(a);
            analyser = ctx.createAnalyser();
            analyser.fftSize = 128;
            src.connect(analyser);
            analyser.connect(ctx.destination);
          }
          void ctx.resume();
          analyser!.getByteFrequencyData(data);
        } catch {
          /* analyser optional */
        }
      }

      // 1 · the TRUE wave (decoded peaks) with progress sweep
      const wave = el.querySelector(".wave-canvas") as HTMLCanvasElement | null;
      if (wave) {
        const dpr = 2;
        const W = (wave.width = wave.offsetWidth * dpr);
        const H = (wave.height = 192);
        const g = wave.getContext("2d")!;
        g.clearRect(0, 0, W, H);
        const peaks = peaksRef.current;
        let prog: number | null = null;
        if (live && a && a.duration) prog = a.currentTime / a.duration;
        else if (flippedRef.current && !everPlayedRef.current) {
          fakeP.current = Math.min(1, fakeP.current + 1 / (6 * 60));
          prog = fakeP.current;
        } else if (flippedRef.current && everPlayedRef.current) prog = 1;
        const bw = W / NCOLS;
        for (let i = 0; i < NCOLS; i++) {
          const v = Math.max(0.05, peaks[i % peaks.length]);
          const h = v * (H - 8);
          const played = prog != null && i / NCOLS <= prog;
          g.fillStyle = played ? "#ff5c0a" : "#34343a";
          const x = i * bw + bw * 0.2;
          g.beginPath();
          g.roundRect(x, (H - h) / 2, Math.max(2, bw * 0.6), h, 3);
          g.fill();
        }
        if (prog != null && prog < 1) {
          const px = prog * W;
          g.fillStyle = "#ffffff";
          g.fillRect(px - 1, 6, 2, H - 12);
        }
      }

      // 2 · avatar ring: the wave, worn as a face
      const ring = el.querySelector(".avatar-ring") as HTMLCanvasElement | null;
      if (ring && inCallRef.current) {
        const S = (ring.width = 296);
        ring.height = 296;
        const g = ring.getContext("2d")!;
        g.clearRect(0, 0, S, S);
        const t = now / 1000;
        for (let i = 0; i < 48; i++) {
          const ang = (i / 48) * Math.PI * 2;
          let v: number;
          if (live && analyser) v = data[Math.floor((i / 48) * 48)] / 255;
          else v = 0.25 + 0.2 * Math.sin(t * 2.2 + i * 0.6);
          const r0 = 100;
          const r1 = r0 + 8 + v * 44;
          g.strokeStyle = live ? "#ff5c0a" : "#8a5a34";
          g.lineWidth = 5;
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(148 + Math.cos(ang) * r0, 148 + Math.sin(ang) * r0);
          g.lineTo(148 + Math.cos(ang) * r1, 148 + Math.sin(ang) * r1);
          g.stroke();
        }
      }

      // 3 · clocks
      const clock = el.querySelector(".play-clock") as HTMLElement | null;
      if (clock && live && a && a.duration) {
        const c = Math.floor(a.currentTime);
        const d = Math.floor(a.duration);
        clock.textContent = `0:${Math.floor(c / 60)}:${String(c % 60).padStart(2, "0")} / 0:${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`;
      }
      const callClock = el.querySelector(".call-clock") as HTMLElement | null;
      if (callClock && inCallRef.current) {
        const s = Math.floor((now - callStart.current) / 1000);
        callClock.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root);
      const face = q(".face-front")[0] as HTMLElement;
      const lineEls = Array.from(q(".code-line")) as HTMLElement[];
      const caret = q(".caret")[0] as HTMLElement;
      const pointer = q(".pointer")[0] as HTMLElement;
      const ripple = q(".ripple")[0] as HTMLElement;
      const runBtn = q(".run-btn")[0] as HTMLElement;
      const status = q(".status-line")[0] as HTMLElement;
      const act = q(".act-label")[0] as HTMLElement;
      const inner = q(".show-inner")[0] as HTMLElement;
      const back = q(".face-back")[0] as HTMLElement;

      const dockCaret = (i: number) => {
        lineEls.forEach((l) => l.classList.remove("active"));
        const el = lineEls[i];
        el.classList.add("active");
        el.appendChild(caret);
        caret.style.display = "inline-block";
      };
      const setAct = (t: string) => {
        act.textContent = t;
      };
      dockCaret(0);

      const typeLine = (i: number, tl: gsap.core.Timeline) => {
        const full = LINES[i];
        tl.add(() => dockCaret(i));
        const proxy = { c: 0 };
        tl.to(proxy, {
          c: full.length,
          duration: Math.max(0.3, full.length * 0.026),
          ease: "none",
          onStart: () => {
            (lineEls[i].querySelector(".code-html") as HTMLElement).innerHTML =
              "";
          },
          onUpdate: () => {
            (lineEls[i].querySelector(".code-html") as HTMLElement).innerHTML =
              hi(full.slice(0, Math.round(proxy.c)));
          },
        });
      };

      const aimPointer = () => {
        const f = face.getBoundingClientRect();
        const b = runBtn.getBoundingClientRect();
        const tx = b.left - f.left + b.width / 2 - 6;
        const ty = b.top - f.top + b.height / 2 - 3;
        gsap.set(pointer, { x: tx + 200, y: ty + 180, opacity: 1, scale: 1 });
        return { tx, ty };
      };

      const prefetch = () => {
        if (!fetchRef.current) {
          fetchRef.current = (async () => {
            try {
              const r = await fetch(`${GW}/v1/tts`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: TRANSCRIPT }),
              });
              if (!r.ok) return null;
              if (blobRef.current) URL.revokeObjectURL(blobRef.current);
              blobRef.current = URL.createObjectURL(await r.blob());
              return blobRef.current;
            } catch {
              return null;
            }
          })();
        }
        return fetchRef.current;
      };

      /** Decode the REAL peaks for the true wave (procedural until it lands). */
      const decodeWave = async () => {
        const blob = blobRef.current;
        if (!blob) return;
        try {
          const AC =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          const tmp = new AC();
          const buf = await tmp.decodeAudioData(
            await (await fetch(blob)).arrayBuffer(),
          );
          const d = buf.getChannelData(0);
          const peaks = new Float32Array(NCOLS);
          const stride = Math.max(1, Math.floor(d.length / NCOLS / 8));
          for (let i = 0; i < NCOLS; i++) {
            let m = 0;
            const s0 = Math.floor((i / NCOLS) * d.length);
            const s1 = Math.floor(((i + 1) / NCOLS) * d.length);
            for (let s = s0; s < s1; s += stride) {
              const v = Math.abs(d[s]);
              if (v > m) m = v;
            }
            peaks[i] = m;
          }
          const max = Math.max(0.001, ...Array.from(peaks));
          for (let i = 0; i < NCOLS; i++)
            peaks[i] = Math.max(0.05, peaks[i] / max);
          peaksRef.current = peaks;
          tmp.close().catch(() => {});
        } catch {
          /* procedural stand-in holds */
        }
      };

      const playRealVoice = () => {
        const a = audioRef.current;
        if (!a) return;
        prefetch().then((blob) => {
          if (!blob || !flippedRef.current) return;
          if (a.src !== blob) a.src = blob;
          a.play()
            .then(() => {
              everPlayedRef.current = true;
            })
            .catch(() => setTapNeeded(true));
        });
      };

      /**
       * One continuous 3D turn with light play. Faces are CSS pre-rotated
       * backface culling performs the swap, no JS flags to fail.
       */
      const doFlip = (tl: gsap.core.Timeline, to: number) => {
        const glare = q(".flip-glare")[0] as HTMLElement;
        const st = { p: 0, from: 0 };
        tl.to(st, {
          p: 1,
          duration: 1.3,
          ease: "power3.inOut",
          // read the angle when the turn STARTS, not when it's built —
          // otherwise the home flip jump-cuts on every loop
          onStart: () => {
            st.from = (gsap.getProperty(inner, "rotationY") as number) || 0;
          },
          onUpdate: () => {
            const edge = Math.sin(st.p * Math.PI);
            gsap.set(inner, {
              rotationY: st.from + (to - st.from) * st.p,
              rotationX: -7 * edge,
              scale: 1 - 0.07 * edge,
            });
            glare.style.opacity = String(0.6 * edge);
            glare.style.transform = `translateX(${-130 + st.p * 260}%) skewX(-12deg)`;
          },
          onComplete: () => {
            gsap.set(inner, { rotationX: 0, scale: 1 });
            glare.style.opacity = "0";
          },
        });
      };

      const tl = gsap.timeline({
        repeat: -1,
        repeatDelay: 0.7,
        defaults: { ease: "power3.inOut" },
        paused: true,
      });

      //  ACT 1 · typing, breathing frame
      tl.add(() => {
        setAct("● TYPING");
        prefetch();
        peaksRef.current = proceduralPeaks(NCOLS);
      });
      LINES.forEach((_, i) => typeLine(i, tl));
      tl.to(
        ".show-zoom",
        { x: 7, y: -6, duration: 2.2, ease: "sine.inOut" },
        0,
      );
      tl.to(".show-zoom", { x: 0, y: 0, duration: 1.1, ease: "sine.inOut" });

      //  ACT 2 · measured strike
      tl.add(() => setAct("● RENDER"));
      const target = { tx: 0, ty: 0 };
      tl.add(() => Object.assign(target, aimPointer()));
      tl.to(pointer, {
        x: () => target.tx,
        y: () => target.ty,
        duration: 0.9,
        ease: "power3.inOut",
      });
      tl.to(pointer, { scale: 0.82, duration: 0.12, ease: "power2.in" });
      tl.fromTo(
        ripple,
        { scale: 0.2, opacity: 0.9 },
        { scale: 2.6, opacity: 0, duration: 0.7, ease: "power2.out" },
        "<",
      );
      tl.to(
        ".show-inner",
        { scale: 0.982, duration: 0.12, ease: "power2.in" },
        "<",
      );
      tl.to(
        ".run-btn",
        { backgroundColor: "#ff5c0a", color: "#000000", duration: 0.2 },
        "<",
      );
      tl.to(".show-inner", {
        scale: 1,
        duration: 0.55,
        ease: "elastic.out(1,0.5)",
      });
      tl.to(pointer, { scale: 1, duration: 0.3 }, "<");
      tl.to(
        ".run-btn",
        {
          backgroundColor: "rgba(255,92,10,0.12)",
          color: "#ff5c0a",
          duration: 0.7,
        },
        "+=0.15",
      );

      const msg = "✓ rendered in 0.8s  24kHz wav ready";
      const sp = { c: 0 };
      tl.to(sp, {
        c: msg.length,
        duration: 0.85,
        ease: "none",
        onStart: () => {
          status.textContent = "";
        },
        onUpdate: () => {
          status.textContent = msg.slice(0, Math.round(sp.c));
        },
      });
      tl.add(() => lineEls.forEach((l) => l.classList.remove("active")));
      tl.to(pointer, { opacity: 0, y: "+=50", duration: 0.5 }, "+=0.3");

      //  ACT 3 · flip → the voice rides the TRUE wave
      tl.add(() => {
        setAct("● PLAYING");
        flippedRef.current = true;
        fakeP.current = 0;
        everPlayedRef.current = false;
        void decodeWave();
      });
      doFlip(tl, 180);
      tl.add(() => playRealVoice());
      tl.to({}, { duration: 3.6 });

      //  ACT 4 · METAMORPHOSIS: player → phone call, beat by beat
      // beat 1 · player content bows out
      tl.add(() => setAct("● INCOMING CALL"));
      tl.to(".layer-player", {
        y: 26,
        autoAlpha: 0,
        duration: 0.55,
        ease: "power2.in",
        stagger: 0.07,
      });
      // beat 2 · the device draws itself: bezel, notch, screen corners
      tl.fromTo(
        ".device-bezel",
        { autoAlpha: 0, scale: 1.04 },
        { autoAlpha: 1, scale: 1, duration: 0.7, ease: "power2.out" },
        "-=0.15",
      );
      tl.to(
        back,
        { borderRadius: "40px", duration: 0.7, ease: "power2.inOut" },
        "<",
      );
      // beat 3 · status bar drops from the top
      tl.fromTo(
        ".call-status",
        { y: -34, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.6, ease: "back.out(1.6)" },
      );
      // beat 4 · the avatar rises  wave worn as a face
      tl.fromTo(
        ".call-ui",
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.4, ease: "power2.out" },
      );
      tl.fromTo(
        ".call-avatar",
        { scale: 0.4, autoAlpha: 0 },
        {
          scale: 1,
          autoAlpha: 1,
          duration: 0.9,
          ease: "back.out(1.4)",
          onStart: () => {
            inCallRef.current = true;
            callStart.current = performance.now();
          },
        },
      );
      // beat 5 · name, timer, controls stagger home
      tl.fromTo(
        ".call-rise",
        { y: 22, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.6,
          ease: "power3.out",
          stagger: 0.07,
        },
      );
      // beat 6 · the call breathes
      tl.to({}, { duration: 2.4 });

      //  ACT 5 · hang up, melt back
      tl.add(() => {
        setAct("● REWIND");
        inCallRef.current = false;
        // full audio + meter reset — next loop starts identical to the first
        const a = audioRef.current;
        if (a) {
          if (!a.paused) a.pause();
          try {
            a.currentTime = 0;
          } catch {
            /* not yet seekable */
          }
        }
        const bar = q(".play-progress")[0] as HTMLElement;
        const clock = q(".play-clock")[0] as HTMLElement;
        const callClock = q(".call-clock")[0] as HTMLElement;
        bar.style.transform = "scaleX(0)";
        clock.textContent = "0:00";
        callClock.textContent = "00:00";
      });
      tl.to(".call-ui", {
        autoAlpha: 0,
        y: 14,
        duration: 0.45,
        ease: "power2.in",
      });
      tl.to(".device-bezel", { autoAlpha: 0, duration: 0.45 }, "<");
      tl.to(
        back,
        { borderRadius: "12px", duration: 0.6, ease: "power2.inOut" },
        "<",
      );
      tl.to(".layer-player", {
        y: 0,
        autoAlpha: 1,
        duration: 0.6,
        ease: "power3.out",
        stagger: 0.06,
      });

      //  ACT 6 · flip home, wipe, loop
      doFlip(tl, 360);
      tl.set(".show-inner", { rotationY: 0 });
      tl.to(lineEls, {
        opacity: 0,
        y: 8,
        duration: 0.22,
        stagger: 0.07,
        ease: "power2.in",
      });
      tl.add(() => {
        lineEls.forEach((el) => {
          (el.querySelector(".code-html") as HTMLElement).innerHTML = "";
        });
        status.textContent = "";
        setTapNeeded(false);
        fetchRef.current = null;
        dockCaret(0);
      });
      tl.to(lineEls, { opacity: 1, y: 0, duration: 0.35, stagger: 0.04 });

      tlRef.current = tl;
    }, root);

    const begin = () => tlRef.current?.play();
    if ((window as unknown as { __oledReady?: boolean }).__oledReady) {
      begin();
    } else {
      window.addEventListener("oled-ready", begin, { once: true });
    }
    return () => {
      window.removeEventListener("oled-ready", begin);
      ctx.revert();
    };
  }, []);

  const tapToHear = async () => {
    const a = audioRef.current;
    if (!a) return;
    try {
      await a.play();
      setTapNeeded(false);
    } catch {
      /* still blocked */
    }
  };

  return (
    <div
      ref={root}
      className="relative h-full w-full"
      style={{ perspective: 1600 }}
    >
      <div
        className="show-inner relative h-full w-full"
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* ══════════ FACE · editor ══════════ */}
        <div
          className="face-front absolute inset-0 overflow-hidden rounded-xl border border-white/10 bg-[#0b0b0d] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
          style={{ backfaceVisibility: "hidden" }}
        >
          <div className="show-zoom h-full w-full will-change-transform">
            <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-2 rounded-md bg-white/5 px-2.5 py-1 font-mono text-[11px] text-fog">
                owambe.py
              </span>

              <span
                className="run-btn ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11px] font-bold text-ember"
                style={{ backgroundColor: "rgba(255,92,10,0.12)" }}
              >
                <Play className="h-3 w-3 fill-current" /> Run
              </span>
            </div>
            <div className="code-body px-5 py-4 font-mono text-[12px] font-medium leading-[2] sm:text-[12.5px]">
              {LINES.map((_, i) => (
                <div
                  key={i}
                  className="code-line flex min-h-[1.9em] whitespace-pre rounded text-zinc-200"
                >
                  <span className="inline-block w-6 shrink-0 select-none pr-3 text-right text-dim/50">
                    {i + 1}
                  </span>
                  <span className="code-html" />
                </div>
              ))}
              <div className="status-line mt-2 min-h-[1.6em] pl-10 text-[12px] text-ember" />
            </div>
            <span className="caret ml-0.5 hidden h-[1.15em] w-[2px] translate-y-[3px] bg-ember shadow-[0_0_8px_rgba(255,92,10,0.9)]" />
          </div>
          <div className="pointer absolute left-0 top-0 z-10 opacity-0 will-change-transform">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="white"
              stroke="black"
              strokeWidth="1.5"
            >
              <path d="M6 3l14 7-6 2-3 6z" />
            </svg>
            <span className="ripple absolute -left-[10px] -top-[13px] block h-8 w-8 rounded-full border-2 border-ember" />
          </div>
          <p className="act-label absolute bottom-3 left-4 font-mono text-[10px] tracking-[0.3em] text-ember/80" />
        </div>

        {/* ══════════ FACE · player → phone call ══════════ */}
        <div
          className="face-back absolute inset-0 overflow-hidden rounded-xl border border-white/10 bg-[#0b0b0d] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] [transform:rotateY(180deg)]"
          style={{ backfaceVisibility: "hidden" }}
        >
          {/* device bezel + notch (drawn in beat 2) */}
          <div className="device-bezel pointer-events-none absolute inset-2.5 rounded-[32px] border border-white/15 opacity-0">
            <div className="absolute left-1/2 top-2.5 h-[22px] w-24 -translate-x-1/2 rounded-full bg-black ring-1 ring-white/10" />
          </div>

          {/* call status bar (drops in beat 3) */}
          <div className="call-status call-ui invisible absolute inset-x-0 top-0 flex items-center justify-between px-8 pt-4 font-mono text-[10px] text-fog opacity-0">
            <span>9:41</span>
            <span className="flex items-center gap-1.5">
              <span className="flex items-end gap-[2px]">
                <i className="block h-1.5 w-[3px] rounded-sm bg-fog" />
                <i className="block h-2.5 w-[3px] rounded-sm bg-fog" />
                <i className="block h-3.5 w-[3px] rounded-sm bg-ember" />
              </span>
              <span className="ml-1 inline-block h-3 w-6 rounded-[4px] border border-fog/60 p-[1.5px]">
                <i className="block h-full w-3/4 rounded-[2px] bg-ember" />
              </span>
            </span>
          </div>

          {/*  layer: player  */}
          <div className="absolute inset-0">
            <div className="layer-player flex items-center justify-between border-b border-white/5 px-5 py-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ember">
                ● Now playing · real render
              </p>
              <p className="play-clock font-mono text-[11px] text-dim">0:00</p>
            </div>
            <div className="layer-player px-5 py-4">
              <p className="font-display text-xl font-bold">
                Owambe invitation
              </p>
              <p className="mt-1 font-mono text-[11px] text-dim">
                Adaeze · Nigerian English · 24kHz
              </p>
              <canvas className="wave-canvas mt-4 h-24 w-full" />
              <p className="mt-4 font-display text-[15px] italic leading-relaxed text-fog">
                “Come chop rice, come dance, come celebrate with us…”
              </p>
              {tapNeeded && (
                <button
                  onClick={tapToHear}
                  className="mt-3 inline-flex items-center gap-2 rounded-full bg-ember px-4 py-1.5 text-xs font-bold text-black"
                >
                  <Volume2 className="h-3.5 w-3.5" /> tap for sound
                </button>
              )}
            </div>
          </div>

          {/*  layer: the call  */}
          <div className="call-ui invisible absolute inset-0 flex flex-col items-center px-6 pb-6 pt-14 opacity-0">
            <div className="call-avatar relative">
              <canvas
                ref={undefined}
                className="avatar-ring h-[148px] w-[148px]"
                width={296}
                height={296}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-ember to-emberdim font-display text-3xl font-bold text-black shadow-[0_0_50px_rgba(255,92,10,0.5)]">
                  A
                </div>
              </div>
            </div>
            <p className="call-rise mt-4 font-display text-2xl font-bold">
              Adaeze
            </p>
            <p className="call-rise mt-1 font-mono text-[11px] text-dim">
              Nigerian English · encrypted
            </p>
            <p className="call-rise call-clock mt-1 font-mono text-xs text-ember">
              00:00
            </p>
            <div className="call-rise mt-auto grid w-full max-w-[240px] grid-cols-3 gap-3">
              {[
                { icon: Mic, label: "mute" },
                { icon: Video, label: "video" },
                { icon: Volume2, label: "speaker" },
              ].map((b) => (
                <span
                  key={b.label}
                  className="flex flex-col items-center gap-1.5"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
                    <b.icon className="h-5 w-5" />
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-dim">
                    {b.label}
                  </span>
                </span>
              ))}
            </div>
            <span className="call-rise mt-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-600 shadow-[0_0_40px_rgba(220,38,38,0.6)]">
              <PhoneOff className="h-6 w-6 text-white" />
            </span>
          </div>

          <audio ref={audioRef} preload="auto" className="hidden" />
        </div>
      </div>
      <div
        className="flip-glare pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent"
        style={{ opacity: 0 }}
      />
    </div>
  );
}
