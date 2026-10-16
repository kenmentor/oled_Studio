"use client";

import { useEffect, useState } from "react";
import { compact, dateTime, money, timeAgo, useAccount, type ApiKey } from "@/lib/store";
import { gateway } from "@/lib/gateway";
import {
  Badge,
  Button,
  Card,
  CardHead,
  Drawer,
  Facts,
  Input,
  Modal,
  SectionLabel,
} from "@/components/ui";
import { IconCheck, IconCopy, IconPlus, IconTrash } from "@/components/icons";

export default function KeysPage() {
  const { account, createKey, revokeKey, refreshKeys } = useAccount();
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<{ secret: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [detail, setDetail] = useState<ApiKey | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    void refreshKeys();
  }, [refreshKeys]);

  if (!account) return null;

  const events = account.events;
  const usageFor = (keyName: string) => events.filter((e) => e.keyName === keyName);

  const create = () => {
    const label = name.trim() || "Untitled key";
    void createKey(label).then(({ secret }) => {
      setIssued({ secret, label });
      setName("");
      setCopied(false);
    });
  };

  const rotate = (k: ApiKey) => {
    // A rotation is a fresh secret under the same name; the caller swaps the
    // value in their app, then the old one is revoked.
    void createKey(`${k.name} (rotated)`).then(({ secret }) => {
      setIssued({ secret, label: `${k.name} (rotated)` });
      setCopied(false);
      setDetail(null);
    });
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">API keys</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {account.keys.length} active · one per service keeps revokes painless
          </p>
        </div>
      </header>

      <Card>
        <CardHead title="Create a key" hint="shown once, never stored in plain text" />
        <div className="flex gap-2 p-5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Production, Staging, Local dev…"
            aria-label="Key name"
          />
          <Button onClick={create}>
            <IconPlus className="size-4" />
            Create
          </Button>
        </div>
      </Card>

      {account.keys.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-zinc-400">No keys yet.</p>
          <p className="mt-1 text-xs text-zinc-600">
            Create one above, then send it to your app as{" "}
            <code className="font-mono text-zinc-500">OLED_API_KEY</code>.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHead title="Active keys" />
          <ul className="divide-y divide-line">
            {account.keys.map((k) => {
              const used = usageFor(k.name);
              const chars = used.reduce((n, e) => n + e.characters, 0);
              return (
                <li key={k.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <button
                    onClick={() => setDetail(k)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-sm">{k.name}</p>
                    <p className="font-mono text-[11px] text-zinc-600">
                      {k.prefix}••••{k.last4}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-zinc-700">
                      {used.length} requests · {compact(chars)} chars · last used{" "}
                      {timeAgo(k.lastUsedAt)}
                    </p>
                  </button>
                  <Badge tone={k.lastUsedAt ? "green" : "neutral"}>
                    {k.lastUsedAt ? "in use" : "unused"}
                  </Badge>
                  <Button variant="outline" size="sm" onClick={() => setDetail(k)}>
                    Details
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setRevokeId(k.id)}>
                    Revoke
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <CardHead title="Using a key" hint={`${gateway.base.replace(/^http/, "ws")}/v1/talk`} />
        <div className="space-y-3 p-5">
          <pre className="overflow-x-auto rounded-md border border-line bg-void p-4 font-mono text-[11px] leading-relaxed text-zinc-400">
{`curl -N -H "Authorization: Bearer $OLED_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"speak","request_id":"r-1","text":"Good morning"}' \\
  ${gateway.base.replace(/^http/, "ws")}/v1/talk`}
          </pre>
          <p className="text-xs leading-relaxed text-zinc-600">
            Keep keys server-side. Anything in a browser bundle is a key anyone can lift.
          </p>
        </div>
      </Card>

      {/* new or rotated secret */}
      <Modal
        open={issued !== null}
        onClose={() => setIssued(null)}
        title={issued?.label.includes("rotated") ? "Rotated — save the new key" : "Save your key"}
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          This is the only time the full key is shown. Put it in your secret store before you
          close this.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-md border border-ember/30 bg-ember/[0.06] px-3 py-2.5">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-gold">
            {issued?.secret}
          </code>
          <Button variant="ghost" size="sm" onClick={() => copy(issued?.secret ?? "")}>
            {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {issued?.label.includes("rotated") && (
          <p className="mt-3 font-mono text-[11px] text-zinc-600">
            Swap the value in your app, then revoke the old key from the list.
          </p>
        )}
        <div className="mt-5 flex justify-end">
          <Button onClick={() => setIssued(null)}>Done</Button>
        </div>
      </Modal>

      {/* key detail */}
      <Drawer
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.name ?? ""}
        subtitle={detail ? `${detail.prefix}••••${detail.last4}` : ""}
        footer={
          detail && (
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setRevokeId(detail.id);
                  setDetail(null);
                }}
              >
                <IconTrash className="size-3.5" />
                Revoke
              </Button>
              <Button size="sm" onClick={() => setRotating(true)}>
                Rotate key
              </Button>
            </div>
          )
        }
      >
        {detail && <KeyFacts k={detail} />}
      </Drawer>

      <Modal open={rotating} onClose={() => setRotating(false)} title="Rotate this key?">
        <p className="text-sm leading-relaxed text-zinc-400">
          You&apos;ll get a new secret called{" "}
          <span className="font-mono text-zinc-300">{detail?.name} (rotated)</span>. The
          current key keeps working until you revoke it.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRotating(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (detail) rotate(detail);
              setRotating(false);
            }}
          >
            Create new key
          </Button>
        </div>
      </Modal>

      <Modal
        open={revokeId !== null}
        onClose={() => setRevokeId(null)}
        title="Revoke this key?"
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          Any service using it stops working immediately. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRevokeId(null)}>
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (revokeId) void revokeKey(revokeId).then(() => setRevokeId(null));
              else setRevokeId(null);
            }}
          >
            Revoke
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function KeyFacts({ k }: { k: ApiKey }) {
  const { account } = useAccount();
  const used = account!.events.filter((e) => e.keyName === k.name);
  const chars = used.reduce((n, e) => n + e.characters, 0);
  const cost = used.reduce((n, e) => n + e.costKobo, 0);
  const avg = used.length ? used.reduce((n, e) => n + e.latencyMs, 0) / used.length : 0;

  return (
    <div className="space-y-6">
      <div>
        <SectionLabel>This cycle</SectionLabel>
        <div className="mt-2">
          <Facts
            items={[
              { label: "Requests", value: used.length.toLocaleString("en-US") },
              { label: "Characters", value: chars.toLocaleString("en-US") },
              { label: "Cost", value: money(cost) },
              { label: "Avg first audio", value: avg ? `${(avg / 1000).toFixed(2)}s` : "—" },
            ]}
          />
        </div>
      </div>
      <div>
        <SectionLabel>Key</SectionLabel>
        <div className="mt-2">
          <Facts
            items={[
              { label: "Prefix", value: k.prefix },
              { label: "Last four", value: k.last4 },
              { label: "Created", value: dateTime(k.createdAt) },
              { label: "Last used", value: timeAgo(k.lastUsedAt) },
            ]}
          />
        </div>
      </div>
      <div>
        <SectionLabel>Last requests</SectionLabel>
        <ul className="mt-2 space-y-1.5">
          {used.slice(0, 5).map((e) => (
            <li key={e.id} className="truncate font-mono text-[11px] text-zinc-600">
              {dateTime(e.at)} — {e.text}
            </li>
          ))}
          {used.length === 0 && <li className="text-xs text-zinc-600">Nothing yet.</li>}
        </ul>
      </div>
    </div>
  );
}
