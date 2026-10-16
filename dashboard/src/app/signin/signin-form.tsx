"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "@/lib/store";
import { asset, gateway } from "@/lib/gateway";
import { Button, Input } from "@/components/ui";
import {
  IconBilling,
  IconGithub,
  IconKeys,
  IconSettings,
  IconSpark,
  IconStudio,
  IconUsage,
  IconVoices,
} from "@/components/icons";

type Mode = "signin" | "signup";

/* Icon wallpaper: the app's own glyphs tiled faintly behind the card. */
const WALLPAPER = [
  IconStudio,
  IconVoices,
  IconKeys,
  IconUsage,
  IconBilling,
  IconSettings,
  IconSpark,
  IconVoices,
  IconUsage,
  IconStudio,
  IconSettings,
  IconKeys,
  IconSpark,
  IconBilling,
  IconStudio,
  IconVoices,
];

function Wallpaper() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -inset-12 grid rotate-[-8deg] grid-cols-4 content-center gap-10 opacity-[0.055]">
        {WALLPAPER.map((Icon, i) => (
          <Icon key={i} className="size-16 text-white" />
        ))}
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_45%,transparent_30%,var(--color-void)_78%)]" />
    </div>
  );
}

export default function SignInForm() {
  const { signIn, createKey } = useAccount();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const oauth = q.get("oauth_error");
    if (oauth) setError(`GitHub sign-in failed (${oauth}).`);
    else if (q.get("expired")) setError("Session expired — sign in again.");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const mail = email.trim().toLowerCase();
    if (!mail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const r = await gateway.signup(
          name.trim() || mail.split("@")[0],
          mail,
          company.trim()
        );
        if (!r.ok) {
          setError(
            r.status === 409
              ? "That email is taken — sign in instead."
              : `Sign-up failed (${r.status}). Is the backend on :8000?`
          );
          return;
        }
        const u = r.body.user;
        signIn(u.name, u.email, u.id, u.avatar_url ?? "", u.company ?? "", u.created_at ?? "");
        try {
          await createKey("Studio");
        } catch {
          /* keys page will create one later */
        }
      } else {
        const r = await gateway.signin(mail);
        if (!r.ok) {
          setError(
            r.status === 404
              ? "No account for that email — create one below."
              : `Sign-in failed (${r.status}). Is the backend on :8000?`
          );
          return;
        }
        const u = r.body.user;
        signIn(u.name, u.email, u.id, u.avatar_url ?? "", u.company ?? "", u.created_at ?? "");
        // No key provisioning here: this browser never holds another device's
        // secret, and the server never re-shows one. Studio provisions a fresh
        // "Studio" key bound to this uid on the first render instead, so the
        // first generation already debits this wallet — no silent pile of keys.
      }
      router.replace("/overview");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5">
      <Wallpaper />
      <div className="animate-in relative w-full max-w-sm">
        <img src={asset("/logo.png")} alt="OLED Studio" className="h-9 w-auto" />
        <h1 className="mt-8 font-display text-3xl font-bold tracking-tight">
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {mode === "signup" ? "250,000 chars on the house." : "Pick up where you left off."}
        </p>

        <Button
          variant="outline"
          className="mt-6 w-full"
          onClick={() => {
            // Land back on THIS console after the API-side OAuth callback,
            // so hosted logins stay hosted and local logins stay local.
            window.location.href = gateway.githubUrl(`${window.location.origin}/overview`);
          }}
        >
          <IconGithub className="size-4" />
          Continue with GitHub
        </Button>

        <div className="my-4 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-700">
          <span className="h-px flex-1 bg-line" />
          or email
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={submit} className="space-y-2.5">
          {mode === "signup" && (
            <div className="grid grid-cols-2 gap-2.5">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                aria-label="Name"
              />
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Company"
                aria-label="Company"
              />
            </div>
          )}
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
            aria-label="Email"
            type="email"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <button
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="mt-4 w-full text-center text-xs text-zinc-500 transition-colors hover:text-ember"
        >
          {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
