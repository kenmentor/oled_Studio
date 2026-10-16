"use client";

import { useEffect, useState } from "react";
import {
  initCounters,
  initHorizontal,
  initMagnetic,
  initParallax,
  initProgress,
  initReveals,
  initScrubWords,
  initSmooth,
  destroyLanding,
  heroIntro,
  refreshScroll,
} from "@/landing/lib/anim";
import { Preloader } from "@/landing/sections/Preloader";
import { Nav } from "@/landing/sections/Nav";
import { Hero } from "@/landing/sections/Hero";
import { Manifesto } from "@/landing/sections/Manifesto";
import { Voices } from "@/landing/sections/Voices";
import { Pipeline } from "@/landing/sections/Pipeline";
import { Developers } from "@/landing/sections/Developers";
import { Numbers } from "@/landing/sections/Numbers";
import { Loved } from "@/landing/sections/Loved";
import { Demo, Footer } from "@/landing/sections/Demo";

export default function LandingPage() {
  const [ready, setReady] = useState(false);

  const done = () => {
    setReady(true);
    // release the hero cinematic exactly as the curtain lifts
    (window as unknown as { __oledReady?: boolean }).__oledReady = true;
    window.dispatchEvent(new Event("oled-ready"));
  };

  useEffect(() => {
    if (!ready) return;
    initSmooth();
    heroIntro();
    initReveals();
    initScrubWords();
    initHorizontal();
    initMagnetic();
    initProgress();
    initCounters();
    initParallax();
    const t = setTimeout(refreshScroll, 400);
    return () => {
      clearTimeout(t);
      destroyLanding();
    };
  }, [ready]);

  return (
    <div className="grain min-h-screen bg-void text-white">
      {!ready && <Preloader onDone={done} />}
      <Nav />
      <Hero />
      <Manifesto />
      <Voices />
      <Pipeline />
      <Developers />
      <Numbers />
      <Loved />
      <Demo />
      <Footer />
    </div>
  );
}
