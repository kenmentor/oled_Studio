"use client";

/* The whole account surface, in one localStorage blob.
 *
 * Still frontend-only, but it holds enough real-shaped data (a month of
 * requests, invoices, teammates, webhooks) that every screen can show
 * something true instead of an empty state. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { gateway, noteAuthFailure, type ServerVoice } from "./gateway";

const KEY = "oled.dashboard.v3";

export type PlanId = "free" | "studio" | "scale";
export interface Plan {
  id: PlanId;
  name: string;
  priceKobo: number;
  quotaChars: number;
  /** Overage per 1k characters once the included quota is gone. */
  overagePer1kKobo: number;
  seats: number;
  blurb: string;
  perks: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceKobo: 0,
    quotaChars: 25_000,
    overagePer1kKobo: 0,
    seats: 1,
    blurb: "Enough to hear the voices.",
    perks: ["25k characters a month", "2 built-in voices", "Community support"],
  },
  studio: {
    id: "studio",
    name: "Studio",
    priceKobo: 850_000,
    quotaChars: 500_000,
    overagePer1kKobo: 40,
    seats: 3,
    blurb: "For people shipping audio every week.",
    perks: [
      "500k characters a month",
      "Unlimited voice clones",
      "Streaming + batch modes",
      "3 seats, email support",
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    priceKobo: 2_900_000,
    quotaChars: 3_000_000,
    overagePer1kKobo: 25,
    seats: 15,
    blurb: "For teams with real traffic.",
    perks: [
      "3M characters a month",
      "Everything in Studio",
      "Priority Qwen pool routing",
      "15 seats, webhooks, 99.9% uptime",
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "studio", "scale"];

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** Full secret, kept only for keys created in this browser. Never displayed again. */
  secret?: string;
}

export interface Voice {
  id: string;
  name: string;
  accent: string;
  builtIn: boolean;
  enabled: boolean;
  sampleSeconds: number;
  /** Data URL of the reference clip, so a saved clone stays previewable. */
  clip?: string;
  clipType?: string;
  /** Playable reference clip, e.g. "/samples/ada.wav" (server-relative). */
  sampleUrl?: string;
  createdAt: number;
}

export interface UsageEvent {
  id: string;
  at: number;
  keyName: string;
  voiceName: string;
  characters: number;
  audioSeconds: number;
  /** Time to first audio chunk. */
  latencyMs: number;
  mode: "stream" | "batch";
  status: "done" | "error";
  text: string;
  costKobo: number;
}

export interface InvoiceLine {
  label: string;
  qty: string;
  amountKobo: number;
}

export interface Invoice {
  id: string;
  number: string;
  issuedAt: number;
  amountKobo: number;
  status: "paid" | "open" | "failed";
  lines: InvoiceLine[];
}

export interface PaymentMethod {
  brand: "visa" | "mastercard";
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  joinedAt: number;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  lastDeliveryAt: number | null;
  failures: number;
}

export interface Prefs {
  usageAlerts: boolean;
  quotaAlerts: boolean;
  invoices: boolean;
  product: boolean;
  /** Percent of quota that triggers the low-quota email. */
  quotaWarnAt: number;
}

export interface Account {
  name: string;
  email: string;
  company: string;
  /** Backend user id (persona or signup user). Empty = pre-auth local demo. */
  uid: string;
  /** GitHub avatar URL, when linked. Empty = initial letter. */
  avatar: string;
  /** Backend signup timestamp (ISO). Empty = pre-dates the field. */
  since: string;
  plan: PlanId;
  /** When the cycle resets. */
  resetAt: number;
  cycleStart: number;
  keys: ApiKey[];
  voices: Voice[];
  defaultVoiceId: string;
  events: UsageEvent[];
  invoices: Invoice[];
  payment: PaymentMethod;
  members: Member[];
  webhooks: Webhook[];
  prefs: Prefs;
}

function randomHex(n: number): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function rate(plan: Plan): number {
  return plan.quotaChars === 0 ? 0 : plan.priceKobo / plan.quotaChars;
}

/* All-real accounts: nothing is seeded. Voices, keys, usage, and invoices
 * arrive from the backend (refreshVoices/refreshKeys pull on signin and on
 * every console mount); the server ledger in /usage and the receipts in
 * /billing are the source of truth. */
function freshAccount(
  name: string,
  email: string,
  uid = "",
  avatar = "",
  company = "",
  createdAt = ""
): Account {
  // Billing cycle starts at signup, not at the calendar month.
  const parsed = Date.parse(createdAt);
  const start = Number.isFinite(parsed) ? parsed : Date.now();
  const end = start + 30 * 86_400_000;
  return {
    name,
    email,
    company,
    uid,
    avatar,
    since: Number.isFinite(parsed) ? new Date(parsed).toISOString() : "",
    plan: "studio",
    resetAt: end,
    cycleStart: start,
    keys: [],
    voices: [],
    defaultVoiceId: "",
    events: [],
    invoices: [],
    payment: { brand: "visa", last4: "4242", expMonth: 11, expYear: new Date().getFullYear() + 2 },
    members: [
      { id: `m-${randomHex(3)}`, name, email, role: "owner", joinedAt: Date.now() },
    ],
    webhooks: [],
    prefs: { usageAlerts: true, quotaAlerts: true, invoices: true, product: false, quotaWarnAt: 80 },
  };
}

interface Ctx {
  account: Account | null;
  ready: boolean;
  signIn: (name: string, email: string, uid?: string, avatar?: string, company?: string, createdAt?: string) => void;
  signOut: () => void;
  updateProfile: (patch: Partial<Pick<Account, "name" | "email" | "company">>) => void;
      createKey: (name: string) => Promise<{ key: ApiKey; secret: string }>;
      revokeKey: (id: string) => Promise<void>;
      refreshKeys: () => Promise<void>;
  /** Server-bound secret for Studio renders. Returns an existing
   *  server-issued secret or provisions a fresh "Studio" key bound to
   *  this uid. Never returns an offline-only secret: money must debit
   *  the same wallet the dashboard displays. Null = backend unreachable. */
  ensureStudioSecret: () => Promise<string | null>;
  addVoice: (v: Omit<Voice, "id" | "createdAt" | "builtIn"> & { enabled?: boolean }) => Promise<void>;
  deleteVoice: (id: string) => Promise<void>;
  setVoiceEnabled: (id: string, enabled: boolean) => Promise<void>;
  useVoice: (id: string) => void;
  /** Pull the voice list from the backend; backend is source of truth. */
  refreshVoices: () => Promise<void>;
  recordUsage: (e: Omit<UsageEvent, "id" | "costKobo">) => void;
  setPlan: (p: PlanId) => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  updatePayment: (p: PaymentMethod) => void;
  inviteMember: (email: string, role: Member["role"]) => void;
  removeMember: (id: string) => void;
  addWebhook: (url: string, events: string[]) => void;
  toggleWebhook: (id: string) => void;
  deleteWebhook: (id: string) => void;
  /** Wipe everything and reseed the demo account. */
  resetDemo: () => void;
}

const AccountCtx = createContext<Ctx | null>(null);

/* ---- backend voice sync: the server owns ids/labels/enabled ---- */

async function postVoice(v: { id: string; label: string; accent: string }): Promise<boolean> {
  try {
    const r = await fetch(`${gateway.base}/v1/voices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...v, language: "en" }),
    });
    return r.ok;
  } catch {
    return false; // offline: stay local-only, sync on next refresh
  }
}

async function patchVoice(id: string, enabled: boolean): Promise<void> {
  try {
    await fetch(`${gateway.base}/v1/voices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  } catch {
    /* offline: local state still updates below */
  }
}

async function deleteVoiceOnServer(id: string): Promise<void> {
  try {
    await fetch(`${gateway.base}/v1/voices/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* offline: local state still updates below */
  }
}

function mergeServerVoices(a: Account, server: ServerVoice[]): Account {
  const local = new Map(a.voices.map((v) => [v.id, v]));
  const voices: Voice[] = server.map((s) => {
    const prev = local.get(s.id);
    return {
      id: s.id,
      name: s.label,
      accent: s.accent,
      builtIn: prev?.builtIn ?? false,
      enabled: s.enabled,
      sampleUrl: s.sample_url || undefined,
      sampleSeconds: prev?.sampleSeconds ?? 0,
      clip: prev?.clip,
      clipType: prev?.clipType,
      createdAt: prev?.createdAt ?? Date.now(),
    };
  });
  const fallback =
    voices.find((v) => v.id === a.defaultVoiceId && v.enabled) ??
    voices.find((v) => v.enabled) ??
    voices[0];
  return { ...a, voices, defaultVoiceId: fallback ? fallback.id : a.defaultVoiceId };
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Account;
        saved.uid = saved.uid ?? "";
        saved.avatar = saved.avatar ?? "";
        saved.since = saved.since ?? "";
        saved.voices = (saved.voices ?? []).map(({ enabled, ...voice }) => ({
          ...voice,
          enabled: enabled ?? true,
        }));
        setAccount(saved);
        setReady(true);
        // The stored uid may predate the server's database (e.g. created
        // while TTS_VOICE_STORE=memory, now Mongo). A 404 means the user
        // no longer exists: drop to signed-out so every call falls back
        // to the persona instead of 404ing forever. Backend down (fetch
        // throws) keeps local state — offline tolerance, not a logout.
        if (saved.uid) {
          fetch(`${gateway.base}/v1/users/me?user_id=${encodeURIComponent(saved.uid)}`, {
            credentials: "include", // a live session rescues a stale uid (200)
          })
            .then((r) => {
              if (r.status === 404) {
                try {
                  localStorage.removeItem(KEY);
                } catch {
                  /* ignore */
                }
                setAccount(null);
              }
            })
            .catch(() => {});
        }
        return;
      }
    } catch {
      /* unreadable blob: start signed out rather than crash */
    }
    setAccount(null);
    setReady(true);
  }, []);

  const persist = useCallback((fn: (a: Account) => Account) => {
    setAccount((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* quota: keep working in memory for the session */
      }
      return next;
    });
  }, []);

  const write = useCallback((next: Account | null) => {
    setAccount(next);
    try {
      if (next) localStorage.setItem(KEY, JSON.stringify(next));
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshVoices = useCallback(async () => {
    const server = await gateway.voices();
    if (!server) return; // backend down: keep whatever we have locally
    persist((a) => mergeServerVoices(a, server));
  }, [persist]);

  const refreshKeys = useCallback(async () => {
    try {
      let uid = "";
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) uid = (JSON.parse(raw) as Account).uid ?? "";
      } catch {
        /* unreadable blob: unfiltered list */
      }
      const r = await fetch(`${gateway.base}/v1/keys${uid ? `?owner_id=${encodeURIComponent(uid)}` : ""}`, {
        credentials: "include", // logged-in session scopes the list server-side
      });
      if (r.status === 401) {
        noteAuthFailure(401);
        return;
      }
      if (!r.ok) return;
      const body = (await r.json()) as {
        keys: { id: string; name: string; prefix: string; last4: string; created_at: string; last_used_at: string | null }[];
      };
      persist((a) => {
        const secrets = new Map(a.keys.map((k) => [k.id, k.secret]));
        return {
          ...a,
          keys: body.keys.map((k) => ({
            id: k.id,
            name: k.name,
            prefix: k.prefix,
            last4: k.last4,
            createdAt: Date.parse(k.created_at),
            lastUsedAt: k.last_used_at ? Date.parse(k.last_used_at) : null,
            secret: secrets.get(k.id),
          })),
        };
      });
    } catch {
      /* backend down: keep local keys */
    }
  }, [persist]);

  const value = useMemo<Ctx>(
    () => ({
      account,
      ready,

      signIn(name, email, uid = "", avatar = "", company = "", createdAt = "") {
        const next = freshAccount(
          name.trim() || "New user",
          email.trim() || "you@example.com",
          uid.trim(),
          avatar.trim(),
          company.trim(),
          createdAt.trim()
        );
        write(next);
        void refreshVoices();
        void refreshKeys();
      },

      signOut() {
        write(null);
      },

      updateProfile(patch) {
        persist((a) => ({ ...a, ...patch }));
      },

      async createKey(name) {
        const label = name.trim() || "Untitled key";
        try {
          let owner = "";
          try {
            const raw = localStorage.getItem(KEY);
            if (raw) owner = (JSON.parse(raw) as Account).uid ?? "";
          } catch {
            /* unreadable blob: persona-owned key */
          }
          const r = await fetch(`${gateway.base}/v1/keys`, {
            method: "POST",
            credentials: "include", // session binds the key to the logged-in user
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: label, owner_id: owner }),
          });
          if (r.status === 401) noteAuthFailure(401);
          if (r.ok) {
            const issued = (await r.json()) as {
              key: { id: string; name: string; prefix: string; last4: string; created_at: string };
              secret: string;
            };
            const key: ApiKey = {
              id: issued.key.id,
              name: issued.key.name,
              prefix: issued.key.prefix,
              last4: issued.key.last4,
              createdAt: Date.parse(issued.key.created_at),
              lastUsedAt: null,
              secret: issued.secret,
            };
            persist((a) => ({ ...a, keys: [key, ...a.keys] }));
            return { key, secret: issued.secret };
          }
        } catch {
          /* offline: fall through to a local-only key */
        }
        const secret = `oled_sk_local_${randomHex(24)}`;
        const key: ApiKey = {
          id: `key-${randomHex(4)}`,
          name: label,
          prefix: secret.slice(0, 19),
          last4: secret.slice(-4),
          createdAt: Date.now(),
          lastUsedAt: null,
          secret,
        };
        persist((a) => ({ ...a, keys: [key, ...a.keys] }));
        return { key, secret };
      },

      async revokeKey(id) {
        try {
          await fetch(`${gateway.base}/v1/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
        } catch {
          /* offline: local state still updates below */
        }
        persist((a) => ({ ...a, keys: a.keys.filter((k) => k.id !== id) }));
      },

      refreshKeys,

      async ensureStudioSecret() {
        const live = account?.keys.find((k) => k.secret?.startsWith("oled_sk_live_"))?.secret;
        if (live) return live;
        try {
          let owner = account?.uid ?? "";
          try {
            const raw = localStorage.getItem(KEY);
            if (raw) owner = (JSON.parse(raw) as Account).uid ?? owner;
          } catch {
            /* keep the in-memory uid */
          }
          const r = await fetch(`${gateway.base}/v1/keys`, {
            method: "POST",
            credentials: "include", // session binds the key to the logged-in user
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Studio", owner_id: owner }),
          });
          if (r.status === 401) noteAuthFailure(401);
          if (!r.ok) return null;
          const issued = (await r.json()) as {
            key: { id: string; name: string; prefix: string; last4: string; created_at: string };
            secret: string;
          };
          if (!issued.secret?.startsWith("oled_sk_live_")) return null;
          const key: ApiKey = {
            id: issued.key.id,
            name: issued.key.name,
            prefix: issued.key.prefix,
            last4: issued.key.last4,
            createdAt: Date.parse(issued.key.created_at),
            lastUsedAt: null,
            secret: issued.secret,
          };
          persist((a) => ({ ...a, keys: [key, ...a.keys] }));
          return issued.secret;
        } catch {
          return null; // offline: Studio stays blocked, never spends from the wrong wallet
        }
      },

      async addVoice(v) {
        const id = `voice-${randomHex(4)}`;
        await postVoice({ id, label: v.name.trim(), accent: v.accent });
        const { enabled, ...rest } = v;
        const created: Voice = {
          ...rest,
          name: v.name.trim(),
          enabled: enabled ?? true,
          id,
          createdAt: Date.now(),
          builtIn: false,
        };
        persist((a) => ({ ...a, voices: [...a.voices, created], defaultVoiceId: created.id }));
      },

      async deleteVoice(id) {
        await deleteVoiceOnServer(id);
        persist((a) => {
          const voices = a.voices.filter((v) => v.id !== id || v.builtIn);
          const defaultVoiceId =
            a.defaultVoiceId === id
              ? (voices.find((v) => v.enabled)?.id ?? "")
              : a.defaultVoiceId;
          return { ...a, voices, defaultVoiceId };
        });
      },

      async setVoiceEnabled(id, enabled) {
        await patchVoice(id, enabled);
        persist((a) => {
          const voices = a.voices.map((v) => (v.id === id ? { ...v, enabled } : v));
          const defaultVoiceId =
            !enabled && a.defaultVoiceId === id
              ? (voices.find((v) => v.id !== id && v.enabled)?.id ?? a.defaultVoiceId)
              : a.defaultVoiceId;
          return { ...a, voices, defaultVoiceId };
        });
      },

      refreshVoices,

      useVoice(id) {
        persist((a) => {
          const voice = a.voices.find((v) => v.id === id);
          if (!voice || !voice.enabled) return a;
          return { ...a, defaultVoiceId: id };
        });
      },

      recordUsage(e) {
        persist((a) => ({
          ...a,
          events: [
            {
              ...e,
              id: `req-${randomHex(5)}`,
              costKobo: Math.round(e.characters * rate(PLANS[a.plan])),
            },
            ...a.events,
          ],
        }));
      },

      setPlan(plan) {
        persist((a) => ({ ...a, plan }));
      },

      setPrefs(patch) {
        persist((a) => ({ ...a, prefs: { ...a.prefs, ...patch } }));
      },

      updatePayment(p) {
        persist((a) => ({ ...a, payment: p }));
      },

      inviteMember(email, role) {
        persist((a) => ({
          ...a,
          members: [
            ...a.members,
            {
              id: `m-${randomHex(3)}`,
              name: email.split("@")[0].replace(/[._]/g, " "),
              email,
              role,
              joinedAt: Date.now(),
            },
          ],
        }));
      },

      removeMember(id) {
        persist((a) => ({ ...a, members: a.members.filter((m) => m.id !== id || m.role === "owner") }));
      },

      addWebhook(url, events) {
        persist((a) => ({
          ...a,
          webhooks: [
            ...a.webhooks,
            { id: `wh-${randomHex(3)}`, url, events, enabled: true, lastDeliveryAt: null, failures: 0 },
          ],
        }));
      },

      toggleWebhook(id) {
        persist((a) => ({
          ...a,
          webhooks: a.webhooks.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w)),
        }));
      },

      deleteWebhook(id) {
        persist((a) => ({ ...a, webhooks: a.webhooks.filter((w) => w.id !== id) }));
      },

      resetDemo() {
        // All-real reset: keep identity, drop cached voices/keys, resync both.
        persist((a) => ({ ...a, voices: [], keys: [], defaultVoiceId: "" }));
        void refreshVoices();
        void refreshKeys();
      },
    }),
    [account, persist, ready, refreshKeys, refreshVoices, write]
  );

  return <AccountCtx.Provider value={value}>{children}</AccountCtx.Provider>;
}

export function useAccount(): Ctx {
  const ctx = useContext(AccountCtx);
  if (!ctx) throw new Error("useAccount must be used inside AccountProvider");
  return ctx;
}

/* ---- selectors: the numbers the whole app agrees on ---- */

export const CYCLE_DAYS = 30;
const CYCLE_MS = CYCLE_DAYS * 86_400_000;

/** Cycle anchor: backend signup date when known, else the stored start.
 *  Future anchors (clock skew) clamp to now so math never goes negative. */
export function cycleStartOf(a: Account): number {
  const parsed = Date.parse(a.since);
  const anchor = Number.isFinite(parsed) ? parsed : a.cycleStart;
  return Math.min(anchor, Date.now());
}

/** Current period end. Rolls forward in 30-day steps when stale (old
 *  blobs, long absence), so the date is always this cycle or the next —
 *  never last month. */
export function resetOf(a: Account): number {
  let end = cycleStartOf(a) + CYCLE_MS;
  const now = Date.now();
  let guard = 0;
  while (end <= now && guard++ < 120) end += CYCLE_MS;
  return end;
}

/** Human countdown: "today" · "tomorrow" · "12 days left". */
export function daysLeftLabel(a: Account): string {
  const d = Math.max(0, Math.ceil((resetOf(a) - Date.now()) / 86_400_000));
  if (d <= 0) return "today";
  if (d === 1) return "tomorrow";
  return `${d} days left`;
}

export function cycleEvents(a: Account): UsageEvent[] {
  const start = cycleStartOf(a);
  return a.events.filter((e) => e.at >= start && e.at < resetOf(a));
}

export function spentChars(a: Account): number {
  return cycleEvents(a).reduce((n, e) => n + e.characters, 0);
}

export function overageKobo(a: Account): number {
  const plan = PLANS[a.plan];
  const over = Math.max(0, spentChars(a) - plan.quotaChars);
  return Math.ceil(over / 1000) * plan.overagePer1kKobo;
}

/** What this cycle has cost so far: the subscription plus any overage. */
export function spentKobo(a: Account): number {
  return PLANS[a.plan].priceKobo + overageKobo(a);
}

export function remainingChars(a: Account): number {
  return Math.max(0, PLANS[a.plan].quotaChars - spentChars(a));
}

export function usageByDay(a: Account): { day: number; chars: number; costKobo: number }[] {
  const start = cycleStartOf(a);
  const days = Math.max(1, Math.min(31, Math.round((Date.now() - start) / 86_400_000) + 1));
  const buckets = new Map<number, { chars: number; costKobo: number }>();
  for (const e of cycleEvents(a)) {
    const day = Math.floor((e.at - start) / 86_400_000);
    const cur = buckets.get(day) ?? { chars: 0, costKobo: 0 };
    cur.chars += e.characters;
    cur.costKobo += e.costKobo;
    buckets.set(day, cur);
  }
  return Array.from({ length: days }, (_, day) => ({
    day: start + day * 86_400_000,
    chars: buckets.get(day)?.chars ?? 0,
    costKobo: buckets.get(day)?.costKobo ?? 0,
  }));
}

/* ---- formatting ---- */

/** Kobo in, naira out: 100 kobo = ₦1. */
export function money(kobo: number): string {  const naira = kobo / 100;
  return naira.toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: Number.isInteger(naira) ? 0 : 2,
    maximumFractionDigits: 2,
    notation: Math.abs(naira) >= 1_000_000 ? "compact" : "standard",
  });
}

/** Wallet conversion, single source of truth: ₦1 buys 1,000 tokens. */
export function tokensMoney(tokens: number): string {
  return money(Math.round(tokens / 10));
}

export function compact(n: number): string {  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function timeAgo(ts: number | null): string {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function dateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Audio length: "4m 12s" reads better than "252s" at a glance. */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function latency(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}
