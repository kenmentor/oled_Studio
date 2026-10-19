"use client";

import Link from "next/link";
import { asset } from "@/lib/gateway";

export function DocsHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#080808]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href="/docs"
          aria-label="OLED Studio documentation home"
          className="flex shrink-0 items-center gap-2.5"
        >
          <img src={asset("/logo.png")} alt="" className="h-6 w-auto" />
          <span className="text-sm font-semibold tracking-tight text-white">
            OLED Studio
          </span>
          <span className="hidden border-l border-white/15 pl-2.5 text-xs text-zinc-500 sm:inline">
            Docs
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link
            href="/overview"
            className="rounded-md px-3 py-2 text-sm text-zinc-400 transition hover:text-white"
          >
            Console
          </Link>

          <Link
            href="/keys"
            className="rounded-md bg-ember px-3.5 py-2 text-sm font-medium text-black transition hover:brightness-110"
          >
            Get API key
          </Link>
        </nav>
      </div>
    </header>
  );
}
