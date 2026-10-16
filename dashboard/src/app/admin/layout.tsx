"use client";

/* Admin chrome: its own header + tab bar. Nothing here comes from the
 * user shell — this area is reachable by direct URL only. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/revenue", label: "Revenue" },
  { href: "/admin/usage", label: "Usage" },
  { href: "/admin/tokens", label: "Tokens" },
  { href: "/admin/signups", label: "Signups" },
  { href: "/admin/keys", label: "API keys" },
  { href: "/admin/traffic", label: "Traffic" },
  { href: "/admin/logins", label: "Logins" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600">
          OLED Studio · restricted
        </p>
        <Link href="/overview" className="font-mono text-[11px] text-zinc-500 hover:text-ember">
          ← back to app
        </Link>
      </div>
      <nav className="mb-8 flex gap-1 overflow-x-auto border-b border-line" aria-label="Admin sections">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "shrink-0 border-b-2 border-ember px-3 py-2.5 text-sm font-medium text-ember"
                  : "shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm text-zinc-500 transition-colors hover:text-zinc-200"
              }
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
