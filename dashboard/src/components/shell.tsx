"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount, compact, tokensMoney } from "@/lib/store";
import { asset, gateway, useServerBalance } from "@/lib/gateway";
import { Meter } from "@/components/charts";
import { Avatar } from "@/components/ui";
import {
  IconBilling,
  IconDocs,
  IconKeys,
  IconOverview,
  IconSettings,
  IconSignOut,
  IconStudio,
  IconUsage,
  IconVoices,
} from "@/components/icons";
import type { ReactNode } from "react";

type Item = { href: string; label: string; icon: (p: { className?: string }) => ReactNode };

/* Grouped so the nav reads as three intentions instead of seven siblings. */
const GROUPS: { label: string; items: Item[] }[] = [
  { label: "", items: [{ href: "/overview", label: "Overview", icon: IconOverview }] },
  {
    label: "Create",
    items: [
      { href: "/studio", label: "Studio", icon: IconStudio },
      { href: "/voices", label: "Voices", icon: IconVoices },
      { href: "/docs", label: "Docs", icon: IconDocs },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/keys", label: "API keys", icon: IconKeys },
      { href: "/usage", label: "Usage", icon: IconUsage },
      { href: "/billing", label: "Billing", icon: IconBilling },
      { href: "/settings", label: "Settings", icon: IconSettings },
    ],
  },
];

function DesktopLink({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "flex items-center gap-2.5 rounded-md bg-ember/10 px-3 py-2 text-sm font-medium text-ember"
          : "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-surface-2 hover:text-zinc-200"
      }
    >
      <Icon className="size-5 shrink-0" />
      <span className="min-w-0 truncate">{item.label}</span>
    </Link>
  );
}

function MobileLink({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "flex shrink-0 items-center gap-1.5 rounded-md bg-ember/10 px-2.5 py-1.5 text-xs font-medium text-ember"
          : "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-zinc-500"
      }
    >
      <Icon className="size-4 shrink-0" />
      {item.label}
    </Link>
  );
}

/** The avatar IS the account menu: click for name, email, sign out. */
function AvatarMenu({
  name,
  email,
  avatar,
  avatarClassName,
  side,
  onSignOut,
}: {
  name: string;
  email: string;
  avatar: string;
  avatarClassName?: string;
  side: "up" | "down";
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        title={name}
        className="block rounded-full transition hover:ring-2 hover:ring-ember/50"
      >
        <Avatar name={name} src={avatar} className={avatarClassName ?? "size-10"} />
      </button>
      {open && (
        <>
          <button
            aria-label="Close account menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
          />
          <div
            className={
              side === "up"
                ? "absolute bottom-12 left-0 z-50 w-60 rounded-xl border border-line bg-surface-2 p-2 shadow-2xl"
                : "absolute right-0 top-12 z-50 w-60 rounded-xl border border-line bg-surface-2 p-2 shadow-2xl"
            }
          >
            <div className="min-w-0 px-2.5 py-2">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate font-mono text-[11px] text-zinc-600">{email}</p>
            </div>
            <button
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-400 transition-colors hover:bg-surface hover:text-zinc-100"
            >
              <IconSignOut className="size-5" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { account, ready, signIn, signOut, createKey } = useAccount();
  const pathname = usePathname();
  const router = useRouter();
  // Admin lives outside this shell entirely (own /admin area, no nav
  // entry, no shortcut): user pages never reference it.
  const groups = GROUPS;

  useEffect(() => {
    if (!ready || account) return;
    // GitHub OAuth lands here with a signed-cookie session but no local
    // account yet: adopt the session user before bouncing to signin.
    let cancelled = false;
    void gateway.me().then(async (u) => {
      if (cancelled || !u) {
        router.replace("/signin");
        return;
      }
      signIn(u.name || "GitHub user", u.email || "", u.id || "", u.avatar_url || "", u.company || "", u.created_at || "");
      try {
        const list = (await fetch(
          `${gateway.base}/v1/keys?owner_id=${encodeURIComponent(u.id)}`,
          { credentials: "include" }
        ).then((x) => (x.ok ? x.json() : null)).catch(() => null)) as { keys: unknown[] } | null;
        if (!cancelled && list && list.keys.length === 0) await createKey("Studio");
      } catch {
        /* keys page will create one later */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, account, router, signIn, createKey]);

  // Dead session with a live local account ("clean dashboard, no stats"):
  // drop the stale account and say so on the sign-in screen, instead of
  // hanging on "connecting…" forever.
  useEffect(() => {
    if (!account) return;
    const onExpired = () => {
      signOut();
      router.replace("/signin?expired=1");
    };
    window.addEventListener("oled-auth-expired", onExpired);
    return () => window.removeEventListener("oled-auth-expired", onExpired);
  }, [account, router, signOut]);

  // Live credits; null while offline so local quota math covers the gap.
  const live = useServerBalance(account?.uid ?? "");

  // Hydration-safe: the store reads localStorage in an effect, so anything
  // rendered before that would flash the wrong sidebar.
  if (!ready) return null;
  if (!account) return null;

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const allItems = groups.flatMap((g) => g.items);

  const handleSignOut = async () => {
    try {
      await gateway.logout();
    } catch {
      /* offline: local state still clears below */
    }
    signOut();
    router.replace("/signin");
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-void lg:flex-row">
      {/* Desktop rail: fixed viewport height, internally scrollable nav, contained footer. */}
      <aside className="sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col overflow-hidden border-r border-line bg-[#070707] lg:flex">
        <div className="shrink-0 px-5 pb-5 pt-6">
          <Link href="/overview" className="flex items-center gap-2.5">
            <img src={asset("/logo.png")} alt="OLED Studio" className="h-7 w-auto" />
            <span className="font-display text-sm font-bold tracking-tight">Console</span>
          </Link>
        </div>

        <nav aria-label="Primary" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-5">
          {groups.map((g) => (
            <div key={g.label || "home"}>
              {g.label && (
                <p className="mb-1.5 px-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-700">
                  {g.label}
                </p>
              )}
              <div className="space-y-0.5">
                {g.items.map((t) => (
                  <DesktopLink key={t.href} item={t} active={isActive(t.href)} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Wallet, always on screen. */}
        <div className="shrink-0 border-t border-line p-3">
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex min-w-0 items-center gap-3">
              <AvatarMenu
                name={account.name}
                email={account.email}
                avatar={account.avatar}
                side="up"
                onSignOut={handleSignOut}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{account.name}</p>
                <p className="tabular truncate font-mono text-[11px] text-zinc-600">
                  {live ? `${tokensMoney(live.balance)} · ${compact(live.balance)} left` : "···"}
                </p>
              </div>
            </div>
            <div className="mt-3">
              <Meter pct={live && live.granted > 0 ? Math.min(100, (live.balance / live.granted) * 100) : 0} />
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen w-full min-w-0 flex-1 flex-col">
        {/* Mobile bar stays slim and sticky; the tab strip scrolls away below it. */}
        <header className="sticky top-0 z-30 border-b border-line/80 bg-void/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Link href="/overview" className="flex min-w-0 items-center gap-2">
              <img src={asset("/logo.png")} alt="OLED Studio" className="h-6 w-auto" />
              <span className="truncate font-display text-sm font-bold tracking-tight">Console</span>
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <AvatarMenu
                name={account.name}
                email={account.email}
                avatar={account.avatar}
                avatarClassName="size-8"
                side="down"
                onSignOut={handleSignOut}
              />
              <Link
                href="/billing"
                className="tabular rounded-full border border-line bg-surface px-3 py-1.5 font-mono text-[11px] text-zinc-300"
              >
                {live ? tokensMoney(live.balance) : "···"}
              </Link>
            </div>
          </div>
        </header>

        <nav aria-label="Primary" className="border-b border-line/70 bg-void lg:hidden">
          <div className="flex gap-1 overflow-x-auto px-4 py-2">
            {allItems.map((t) => (
              <MobileLink key={t.href} item={t} active={isActive(t.href)} />
            ))}
          </div>
        </nav>

        <main className="w-full min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto w-full min-w-0 max-w-3xl animate-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
