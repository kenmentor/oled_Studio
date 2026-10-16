"use client";

import { useEffect, useState } from "react";

/* Backend client. Speaks the server/ v1 contract only:
 *   GET  /health            {ok, provider, model_version, voices}
 *   GET  /v1/voices         {voices: [{id, label, accent, enabled}], model_version}
 *   POST /v1/speech         audio/wav
 *   WS   /v1/talk           text in, chunked WAV back on the same socket
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const BASE =
  process.env.NEXT_PUBLIC_MIDDLEMAN_URL?.replace(/\/$/, "") ||
  (typeof window !== "undefined" && window.location.port === "8000"
    ? window.location.origin
    : `http://${typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "127.0.0.1"}:8000`);

/** Static asset under the dashboard's own subpath (/console/logo.png live). */
export const asset = (p: string) => `${BASE_PATH}${p}`;

/** A 401 from any data call means the session is dead or missing while the
 *  UI still holds a local account ("clean dashboard, no stats"). Broadcast
 *  it so the shell can route to sign-in instead of hanging on "connecting…". */
export function noteAuthFailure(status: number) {
  if (status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("oled-auth-expired"));
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, init);
    if (r.status === 401) {
      noteAuthFailure(401);
      return null;
    }
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null; // offline: callers show their connecting state
  }
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
}

export interface ServerVoice {
  id: string;
  label: string;
  accent: string;
  language: string;
  enabled: boolean;
  sample_url: string;
}

export interface Health {
  ok: boolean;
  provider: string;
  model_version: string;
  sample_rate: number;
  voices: number;
}

export const gateway = {
  base: BASE,
  online: () => get<Health>("/health").then((h) => h.ok).catch(() => false),
  info: () => get<Health>("/health").catch(() => null),
  voices: () =>
    get<{ voices: ServerVoice[]; model_version: string }>("/v1/voices")
      .then((r) => r.voices)
      .catch(() => null),
  balance: (user_id = "") =>
    fetchJson<{
      user_id: string; email: string; balance_chars: number; spent_chars: number; granted_chars: number;
    }>(`${BASE}/v1/billing/balance${user_id ? `?user_id=${encodeURIComponent(user_id)}` : ""}`, {
      credentials: "include", // server session wins over the param when logged in
    }),
  topup: (amount_kobo: number, card_number: string, user_id = "") =>
    fetch(`${BASE}/v1/billing/topup`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount_kobo, card_number, user_id }),
    }).then(async (r) => {
      if (r.status === 401) noteAuthFailure(401);
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
    }),
  usage: (limit = 100, user_id = "") =>
    fetchJson<{
      events: {
        id: string; at: string; key_name: string; voice: string; chars: number;
        text: string; audio_seconds: number; latency_ms: number; mode: string;
        status: string; cost_chars: number; balance_after: number;
      }[];
    }>(`${BASE}/v1/usage?limit=${limit}${user_id ? `&user_id=${encodeURIComponent(user_id)}` : ""}`, {
      credentials: "include",
    }),
  invoices: (user_id = "") =>
    fetchJson<{
      invoices: { id: string; number: string; amount_kobo: number; granted_chars: number; card_last4: string; created_at: string }[];
    }>(`${BASE}/v1/billing/invoices${user_id ? `?user_id=${encodeURIComponent(user_id)}` : ""}`, {
      credentials: "include",
    }),
  signup: (name: string, email: string, company: string) =>
    fetch(`${BASE}/v1/auth/signup`, {
      method: "POST",
      credentials: "include", // accept the login cookie the server sets
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, company }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })),
  signin: (email: string) =>
    fetch(`${BASE}/v1/auth/signin`, {
      method: "POST",
      credentials: "include", // accept the login cookie the server sets
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })),
  me: () =>
    fetchJson<{
      id: string; name: string; email: string; company: string;
      avatar_url: string; created_at: string; balance_chars: number;
    }>(`${BASE}/v1/users/me`, { credentials: "include" }),
  logout: () =>
    fetch(`${BASE}/v1/auth/logout`, { method: "POST", credentials: "include" }).catch(() => null),
  githubUrl: (returnTo?: string) =>
    returnTo
      ? `${BASE}/v1/auth/github?return_to=${encodeURIComponent(returnTo)}`
      : `${BASE}/v1/auth/github`,
  // Ask the server if funding is switched on (and test vs live mode).
  // Public info only — no secrets involved.
  paystackConfig: () =>
    fetchJson<{ enabled: boolean; test_mode: boolean }>(`${BASE}/v1/billing/paystack/config`),
  // Start a top-up: server books reference oled-... and returns the
  // checkout.paystack.com URL. The browser LEAVES for Paystack here —
  // card details are entered there, never in our app.
  paystackInit: (amount_kobo: number) =>
    fetch(`${BASE}/v1/billing/paystack/initialize`, {
      method: "POST",
      credentials: "include", // session binds the payment to YOUR wallet
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount_kobo }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })),
  // READ-ONLY status poll (pending/confirmed/failed). Calling this NEVER
  // credits anything — only the server-side webhook moves money.
  paystackVerify: (reference: string) =>
    fetch(`${BASE}/v1/billing/paystack/verify?reference=${encodeURIComponent(reference)}`, {
      credentials: "include",
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })),
  // One chronological money feed: confirmed top-ups + pending/failed
  // attempts. Fulfilled money appears exactly once (as its top-up).
  transactions: () =>
    fetchJson<{
      transactions: { id: string; kind: string; status: string; amount_kobo: number; granted_chars: number; label: string; created_at: string }[];
    }>(`${BASE}/v1/billing/transactions`, { credentials: "include" }),
  // Admin overview (ADMIN_EMAILS-gated server-side). 401/403 surface here.
  adminOverview: () =>
    fetch(`${BASE}/v1/admin/overview`, { credentials: "include" }).then(async (r) => ({
      ok: r.ok,
      status: r.status,
      body: await r.json().catch(() => null),
    })),
};

/** WS /v1/talk: text out, chunked WAV back on the same socket.
 *  Identity is the api_key (server derives the owner and debits that
 *  wallet). The server's done frame carries balance_chars; errors carry
 *  {code, message} — e.g. insufficient_credits with the top-up hint. */
export function speak(
  text: string,
  onChunk: (bytes: ArrayBuffer) => void,
  opts: { voiceId?: string; sessionId?: string; apiKey?: string; preview?: boolean } = {}
): { done: Promise<{ bytes: number; firstChunkMs: number; balanceChars: number | null }>; cancel: () => void } {
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/v1/talk`);
  ws.binaryType = "arraybuffer";
  const rid = `r-${Math.random().toString(36).slice(2, 10)}`;
  const started = Date.now();
  let bytes = 0;
  let firstChunkMs = -1;
  let settled = false;
  let balanceChars: number | null = null;

  const done = new Promise<{ bytes: number; firstChunkMs: number; balanceChars: number | null }>((resolve, reject) => {
    // Huge texts render for minutes: the timeout must be idle-based (no
    // frame of any kind for 60s = stuck server), not absolute, or slow
    // renders get killed mid-playback even while chunks keep flowing.
    // A 10-minute absolute cap stays as a backstop for truly lost sockets.
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let absoluteTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (!settled) {
        settled = true;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = absoluteTimer = null;
        try {
          console.warn(`[ws] absolute timeout rid=${rid} after 10m (bytes=${bytes})`);
        } catch {
          /* ignore */
        }
        ws.close();
        reject(new Error("timed out"));
      }
    }, 10 * 60_000);
    const clearTimers = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (absoluteTimer) clearTimeout(absoluteTimer);
      idleTimer = absoluteTimer = null;
    };
    const touchIdle = () => {
      if (settled) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            console.warn(`[ws] idle timeout rid=${rid} — 60s with no frame (bytes=${bytes})`);
          } catch {
            /* ignore */
          }
          clearTimers();
          ws.close();
          reject(new Error("timed out waiting for audio — server went quiet"));
        }
      }, 60_000);
    };
    const settleOk = (v: { bytes: number; firstChunkMs: number; balanceChars: number | null }) => {
      if (settled) return;
      settled = true;
      clearTimers();
      ws.close();
      resolve(v);
    };
    const settleErr = (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(e);
    };
    ws.addEventListener("open", () => {
      touchIdle();
      try {
        console.info(`[ws] open rid=${rid} chars=${text.length} voice=${opts.voiceId ?? "default"}`);
      } catch {
        /* ignore */
      }
      ws.send(
        JSON.stringify({
          type: "speak",
          request_id: rid,
          text,
          ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
          ...(opts.voiceId ? { voice_id: opts.voiceId } : {}),
          ...(opts.apiKey ? { api_key: opts.apiKey } : {}),
          ...(opts.preview ? { preview: true } : {}),
        })
      );
    });
    ws.addEventListener("message", (ev) => {
      touchIdle();
      if (typeof ev.data !== "string") {
        const buf = ev.data as ArrayBuffer;
        if (firstChunkMs < 0) {
          firstChunkMs = Date.now() - started;
          try {
            console.info(`[ws] first audio frame rid=${rid} after ${firstChunkMs}ms (${buf.byteLength} bytes)`);
          } catch {
            /* ignore */
          }
        }
        bytes += buf.byteLength;
        onChunk(buf);
        return;
      }
      try {
        const msg = JSON.parse(ev.data) as {
          type: string;
          error?: string;
          code?: string;
          message?: string;
          balance_chars?: number;
        };
        if (msg.type === "done") {
          if (typeof msg.balance_chars === "number") balanceChars = msg.balance_chars;
          try {
            console.info(
              `[ws] done rid=${rid} bytes=${bytes} firstAudio=${firstChunkMs}ms total=${((Date.now() - started) / 1000).toFixed(1)}s`
            );
          } catch {
            /* ignore */
          }
          settleOk({ bytes, firstChunkMs, balanceChars });
        } else if (msg.type === "error") {
          const code = msg.code || "render_failed";
          const detail = msg.message || msg.error || "render failed";
          try {
            console.warn(`[ws] error rid=${rid} ${code}: ${detail}`);
          } catch {
            /* ignore */
          }
          settleErr(new Error(`${code}: ${detail}`));
        } else if (msg.type === "started") {
          try {
            console.info(`[ws] started rid=${rid} voice=${(msg as { voice_id?: string }).voice_id ?? "?"} sr=${(msg as { sample_rate?: number }).sample_rate ?? "?"}`);
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore non-JSON frames */
      }
    });
    ws.addEventListener("error", () => {
      settleErr(new Error(`Gateway unreachable at ${BASE}`));
    });
    ws.addEventListener("close", () => {
      settleErr(new Error("connection closed"));
    });
  });

  return {
    done,
    cancel: () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "cancel", request_id: rid }));
      }
      ws.close();
    },
  };
}

/** POST /v1/speech: one request, one complete WAV back.
 *  Same return shape as the WS speak() above so callers can swap
 *  transports without branching: {done, cancel}. HTTP has no progressive
 *  chunks, so firstChunkMs == total time (reported honestly, not faked).
 *  Identity is the Bearer secret; the server debits that wallet and
 *  returns the balance in X-Balance-Chars. */
export function speakHttp(
  text: string,
  onData: (bytes: ArrayBuffer) => void,
  opts: { voiceId?: string; sessionId?: string; apiKey?: string; preview?: boolean } = {}
): { done: Promise<{ bytes: number; firstChunkMs: number; balanceChars: number | null }>; cancel: () => void } {
  const ctrl = new AbortController();
  const started = Date.now();
  let settled = false;

  const done = (async () => {
    let r: Response;
    try {
      r = await fetch(`${BASE}/v1/speech`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          text,
          ...(opts.voiceId ? { voice_id: opts.voiceId } : {}),
          ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
          ...(opts.preview ? { preview: true } : {}),
        }),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new Error("cancelled");
      throw new Error(`Gateway unreachable at ${BASE}`);
    }
    if (r.status === 401) {
      noteAuthFailure(401);
      throw new Error("unauthorized: sign in again");
    }
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      const err = body?.error as { code?: string; message?: string } | undefined;
      throw new Error(`${err?.code || `http_${r.status}`}: ${err?.message || "render failed"}`);
    }
    const buf = await r.arrayBuffer();
    if (!settled) onData(buf);
    const ms = Date.now() - started;
    const bal = r.headers.get("x-balance-chars");
    return {
      bytes: buf.byteLength,
      firstChunkMs: ms,
      balanceChars: bal !== null ? Number(bal) : null,
    };
  })();
  done.catch(() => { settled = true; });

  return {
    done,
    cancel: () => {
      settled = true;
      ctrl.abort();
    },
  };
}
export function useGatewayHealth() {
  const [state, setState] = useState<{
    online: boolean;
    voices: number | null;
    modelVersion: string | null;
  }>({ online: false, voices: null, modelVersion: null });

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const info = await gateway.info();
      if (alive) {
        setState({
          online: info !== null,
          voices: info ? info.voices : null,
          modelVersion: info ? info.model_version : null,
        });
      }
    };
    void check();
    const t = setInterval(check, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return state;
}

/** Live credit balance for the signed-in user. Refetches on mount,
 *  tab focus, every 30s, and whenever anyone dispatches "oled-balance"
 *  (Studio renders, billing top-ups). Null while offline/unknown. */
export function useServerBalance(uid: string) {
  const [state, setState] = useState<{
    balance: number;
    spent: number;
    granted: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const b = await gateway.balance(uid);
      if (alive && b) {
        setState({
          balance: b.balance_chars,
          spent: b.spent_chars ?? 0,
          granted: b.granted_chars ?? 0,
        });
      }
    };
    void load();
    const onEvent = () => void load();
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("oled-balance", onEvent);
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("oled-balance", onEvent);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [uid]);

  return state;
}

/** Tell every balance hook to refetch now. */
export const refreshBalance = () => window.dispatchEvent(new Event("oled-balance"));
