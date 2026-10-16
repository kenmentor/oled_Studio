import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);

let lenis: Lenis | null = null;

export function initSmooth() {
  if (lenis) return lenis;
  lenis = new Lenis({ lerp: 0.09 });
  const raf = (t: number) => {
    lenis?.raf(t);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  lenis.on("scroll", ScrollTrigger.update);
  return lenis;
}

export function refreshScroll() {
  ScrollTrigger.refresh();
}

/** Calm rise reveals. */
export function initReveals() {
  gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) => {
    gsap.fromTo(
      el,
      { y: 34, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 88%" },
      }
    );
  });
}

/** Hero masked-line + meta intro. */
export function heroIntro() {
  const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
  tl.to(".mask-line > span", { y: 0, duration: 1.2, stagger: 0.1 }, 0.15)
    .fromTo(".h-fade", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, stagger: 0.09 }, 0.6);
  return tl;
}

/** Word-by-word scrub reveal for manifesto paragraphs (.scrub-words span). */
export function initScrubWords() {
  gsap.utils.toArray<HTMLElement>(".scrub-words").forEach((el) => {
    const words = el.querySelectorAll("span");
    gsap.fromTo(
      words,
      { opacity: 0.12 },
      {
        opacity: 1,
        stagger: 0.06,
        ease: "none",
        scrollTrigger: { trigger: el, start: "top 80%", end: "bottom 45%", scrub: 0.6 },
      }
    );
  });
}

/** Pinned horizontal scroll: .hwrap (viewport) > .htrack (wide flex). */
export function initHorizontal() {
  const wrap = document.querySelector<HTMLElement>(".hwrap");
  const track = document.querySelector<HTMLElement>(".htrack");
  if (!wrap || !track) return;
  const dist = () => track.scrollWidth - wrap.clientWidth;
  gsap.to(track, {
    x: () => -dist(),
    ease: "none",
    scrollTrigger: {
      trigger: wrap,
      start: "top top",
      end: () => `+=${dist()}`,
      pin: true,
      scrub: 1,
      invalidateOnRefresh: true,
    },
  });
}

/** Magnetic pull for .magnetic elements. */
export function initMagnetic() {
  if (window.matchMedia("(pointer: coarse)").matches) return;
  document.querySelectorAll<HTMLElement>(".magnetic").forEach((el) => {
    const strength = 26;
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      gsap.to(el, {
        x: (e.clientX - r.left - r.width / 2) / (r.width / 2) * strength,
        y: (e.clientY - r.top - r.height / 2) / (r.height / 2) * strength,
        duration: 0.4,
        ease: "power3.out",
      });
    });
    el.addEventListener("mouseleave", () => gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1,0.4)" }));
  });
}

/** Top scroll progress bar (.progress). */
export function initProgress() {
  gsap.to(".progress", {
    scaleX: 1,
    ease: "none",
    scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: 0.3 },
  });
}

/** Animated counters. */
export function initCounters() {
  gsap.utils.toArray<HTMLElement>(".count").forEach((el) => {
    const to = parseFloat(el.dataset.to || "0");
    const dec = parseInt(el.dataset.dec || "0", 10);
    const obj = { v: 0 };
    ScrollTrigger.create({
      trigger: el,
      start: "top 90%",
      once: true,
      onEnter: () =>
        gsap.to(obj, {
          v: to,
          duration: 1.8,
          ease: "power2.out",
          onUpdate: () => {
            el.textContent = obj.v.toFixed(dec);
          },
        }),
    });
  });
}

/** Parallax on [data-speed] elements. */
export function initParallax() {
  gsap.utils.toArray<HTMLElement>("[data-speed]").forEach((el) => {
    gsap.to(el, {
      y: () => (1 - parseFloat(el.dataset.speed || "1")) * 200,
      ease: "none",
      scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 1 },
    });
  });
}

export function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export const GW = (import.meta as unknown as { env: Record<string, string> }).env
  .VITE_MIDDLEMAN_URL || "http://127.0.0.1:8000";
