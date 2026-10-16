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
  heroIntro,
  refreshScroll,
} from "@/lib/anim";
import { Preloader } from "@/sections/Preloader";
import { Nav } from "@/sections/Nav";
import { Hero } from "@/sections/Hero";
import { Manifesto } from "@/sections/Manifesto";
import { Voices } from "@/sections/Voices";
import { Pipeline } from "@/sections/Pipeline";
import { Developers } from "@/sections/Developers";
import { Numbers } from "@/sections/Numbers";
import { Loved } from "@/sections/Loved";
import { Demo, Footer } from "@/sections/Demo";

export default function App() {
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
    return () => clearTimeout(t);
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
