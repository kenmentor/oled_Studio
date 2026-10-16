"use client";

import { useState } from "react";
import { PLANS, timeAgo, useAccount, type Member } from "@/lib/store";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHead,
  Drawer,
  Facts,
  Input,
  Modal,
  SectionLabel,
  Select,
  SettingRow,
  Switch,
} from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";

const WEBHOOK_EVENTS = [
  "render.done",
  "render.failed",
  "key.created",
  "key.revoked",
  "voice.created",
  "quota.threshold",
];

export default function SettingsPage() {
  const {
    account,
    updateProfile,
    setPrefs,
    inviteMember,
    removeMember,
    addWebhook,
    toggleWebhook,
    deleteWebhook,
    resetDemo,
    signOut,
  } = useAccount();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [saved, setSaved] = useState(false);
  const [invite, setInvite] = useState<{ email: string; role: Member["role"] } | null>(null);
  const [hook, setHook] = useState<{ url: string; events: string[] } | null>(null);
  const [wiping, setWiping] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!account) return null;

  const plan = PLANS[account.plan];
  const seatsLeft = Math.max(0, plan.seats - account.members.length);

  const saveProfile = () => {
    updateProfile({
      name: name.trim() || account.name,
      email: email.trim() || account.email,
      company: company.trim() || account.company,
    });
    setName("");
    setEmail("");
    setCompany("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Avatar name={account.name} src={account.avatar} className="size-10" />
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 truncate text-sm text-zinc-500">
            {account.company} · {account.email}
          </p>
        </div>
      </header>

      <Card>
        <CardHead
          title="Profile"
          children={
            <Button size="sm" onClick={saveProfile}>
              {saved ? "Saved" : "Save"}
            </Button>
          }
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block font-mono text-[11px] text-zinc-600">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={account.name} />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-mono text-[11px] text-zinc-600">Email</span>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={account.email} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block font-mono text-[11px] text-zinc-600">Company</span>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder={account.company} />
          </label>
        </div>
      </Card>

      <Card>
        <CardHead title="Emails" hint="what we send, and when" />
        <div className="divide-y divide-line px-5">
          <SettingRow
            title="Usage alerts"
            hint="A ping when a request fails or a key looks wrong."
          >
            <Switch
              label="Usage alerts"
              checked={account.prefs.usageAlerts}
              onChange={(v) => setPrefs({ usageAlerts: v })}
            />
          </SettingRow>
          <SettingRow
            title="Quota warnings"
            hint={`Tell me at ${account.prefs.quotaWarnAt}% of the monthly characters.`}
          >
            <Switch
              label="Quota warnings"
              checked={account.prefs.quotaAlerts}
              onChange={(v) => setPrefs({ quotaAlerts: v })}
            />
          </SettingRow>
          <SettingRow title="Invoices" hint="A receipt for every cycle, paid or not.">
            <Switch
              label="Invoices"
              checked={account.prefs.invoices}
              onChange={(v) => setPrefs({ invoices: v })}
            />
          </SettingRow>
          <SettingRow title="Product news" hint="Occasional, never more than monthly.">
            <Switch
              label="Product news"
              checked={account.prefs.product}
              onChange={(v) => setPrefs({ product: v })}
            />
          </SettingRow>
        </div>
        <div className="border-t border-line px-5 py-4">
          <label className="block max-w-xs">
            <span className="mb-1.5 block font-mono text-[11px] text-zinc-600">
              Warn me at
            </span>
            <Select
              value={String(account.prefs.quotaWarnAt)}
              onChange={(e) => setPrefs({ quotaWarnAt: Number(e.target.value) })}
            >
              {[50, 70, 80, 90, 95].map((p) => (
                <option key={p} value={p}>
                  {p}% of quota
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      <Card>
        <CardHead
          title="Team"
          hint={`${account.members.length} of ${plan.seats} seats`}
          children={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInvite({ email: "", role: "member" })}
              disabled={seatsLeft === 0}
            >
              <IconPlus className="size-3.5" />
              Invite
            </Button>
          }
        />
        <ul className="divide-y divide-line">
          {account.members.map((m) => (
            <li key={m.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {m.name}
                  {m.email === account.email && (
                    <span className="ml-2 font-mono text-[10px] text-zinc-600">you</span>
                  )}
                </p>
                <p className="truncate font-mono text-[11px] text-zinc-600">
                  {m.email} · joined {timeAgo(m.joinedAt)}
                </p>
              </div>
              <Badge tone={m.role === "owner" ? "ember" : "neutral"}>{m.role}</Badge>
              {m.role !== "owner" && (
                <Button variant="ghost" size="sm" onClick={() => removeMember(m.id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        {seatsLeft === 0 && (
          <p className="border-t border-line px-5 py-3 font-mono text-[11px] text-zinc-600">
            All {plan.seats} seats are in use. Upgrade for more.
          </p>
        )}
      </Card>

      <Card>
        <CardHead
          title="Webhooks"
          hint="fire on every render"
          children={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHook({ url: "", events: ["render.done"] })}
            >
              <IconPlus className="size-3.5" />
              Add
            </Button>
          }
        />
        <ul className="divide-y divide-line">
          {account.webhooks.map((w) => (
            <li key={w.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] text-zinc-300">{w.url}</p>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-600">
                  {w.events.join(", ")} · last delivery {timeAgo(w.lastDeliveryAt)}
                  {w.failures > 0 && ` · ${w.failures} failed`}
                </p>
              </div>
              <Switch
                label={`Toggle ${w.url}`}
                checked={w.enabled}
                onChange={() => toggleWebhook(w.id)}
              />
              <Button variant="ghost" size="sm" onClick={() => deleteWebhook(w.id)}>
                <IconTrash className="size-3.5" />
              </Button>
            </li>
          ))}
          {account.webhooks.length === 0 && (
            <li className="px-5 py-6 text-sm text-zinc-600">
              No webhooks. Add one to get render events in your app.
            </li>
          )}
        </ul>
      </Card>

      <Card>
        <CardHead title="Danger zone" hint="these cannot be undone" />
        <div className="divide-y divide-line px-5">
          <SettingRow
            title="Reset demo data"
            hint="Clears cached voices and keys in this browser and pulls them fresh from the backend."
          >
            <Button variant="danger" size="sm" onClick={() => setWiping(true)}>
              Reset
            </Button>
          </SettingRow>
          <SettingRow title="Delete account" hint="Removes keys, voices and every invoice.">
            <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </SettingRow>
        </div>
      </Card>

      {/* invite */}
      <Modal open={invite !== null} onClose={() => setInvite(null)} title="Invite someone">
        <div className="space-y-4">
          <Input
            value={invite?.email ?? ""}
            onChange={(e) => setInvite((v) => (v ? { ...v, email: e.target.value } : v))}
            placeholder="name@company.com"
            aria-label="Email address"
            type="email"
          />
          <Select
            value={invite?.role ?? "member"}
            onChange={(e) =>
              setInvite((v) => (v ? { ...v, role: e.target.value as Member["role"] } : v))
            }
            aria-label="Role"
          >
            <option value="admin">Admin — keys and billing</option>
            <option value="member">Member — studio only</option>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setInvite(null)}>
              Cancel
            </Button>
            <Button
              disabled={!invite?.email.includes("@")}
              onClick={() => {
                if (invite?.email.includes("@")) inviteMember(invite.email, invite.role);
                setInvite(null);
              }}
            >
              Send invite
            </Button>
          </div>
        </div>
      </Modal>

      {/* webhook */}
      <Modal open={hook !== null} onClose={() => setHook(null)} title="Add a webhook">
        <div className="space-y-4">
          <Input
            value={hook?.url ?? ""}
            onChange={(e) => setHook((h) => (h ? { ...h, url: e.target.value } : h))}
            placeholder="https://your.app/hooks/oled"
            aria-label="Webhook URL"
          />
          <div>
            <SectionLabel>Events</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {WEBHOOK_EVENTS.map((ev) => {
                const on = hook?.events.includes(ev);
                return (
                  <button
                    key={ev}
                    onClick={() =>
                      setHook((h) =>
                        h
                          ? {
                              ...h,
                              events: on ? h.events.filter((x) => x !== ev) : [...h.events, ev],
                            }
                          : h
                      )
                    }
                    className={
                      on
                        ? "rounded-full border border-ember/40 bg-ember/10 px-2.5 py-1 font-mono text-[10px] text-ember"
                        : "rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-zinc-500"
                    }
                  >
                    {ev}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setHook(null)}>
              Cancel
            </Button>
            <Button
              disabled={!hook?.url.startsWith("http")}
              onClick={() => {
                if (hook?.url.startsWith("http")) addWebhook(hook.url, hook.events);
                setHook(null);
              }}
            >
              Add webhook
            </Button>
          </div>
        </div>
      </Modal>

      {/* reset confirm */}
      <Modal open={wiping} onClose={() => setWiping(false)} title="Reset cached data?">
        <p className="text-sm leading-relaxed text-zinc-400">
          Cached voices and keys in this browser are dropped and re-pulled from
          the backend. Your account, balance, and history are untouched.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setWiping(false)}>
            Keep my data
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              resetDemo();
              setWiping(false);
            }}
          >
            Reset everything
          </Button>
        </div>
      </Modal>

      {/* delete account confirm: clears local data and signs out */}
      <Modal open={deleting} onClose={() => setDeleting(false)} title="Delete this account?">
        <p className="text-sm leading-relaxed text-zinc-400">
          This clears every key, voice, invoice, and preference stored in this browser.
          You will be signed out immediately. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(false)}>
            Keep my account
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              signOut();
              setDeleting(false);
            }}
          >
            Delete everything
          </Button>
        </div>
      </Modal>
    </div>
  );
}
