"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "@/lib/store";
import { gateway } from "@/lib/gateway";
import { Badge, Button, Card, CardHead, Input, Modal, Select, Switch } from "@/components/ui";

const ACCENTS = [
  "Nigerian",
  "Nigerian · Igbo",
  "Nigerian · Yoruba",
  "Nigerian · Hausa",
  "US",
  "UK",
  "South Africa",
];

export default function VoicesPage() {
  const { account, addVoice, deleteVoice, setVoiceEnabled, useVoice, refreshVoices } = useAccount();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void refreshVoices();
  }, [refreshVoices]);

  if (!account) return null;

  const preview = (id: string, src: string) => {
    const a = previewRef.current;
    if (!a) return;
    if (playingId === id) {
      a.pause();
      setPlayingId(null);
      return;
    }
    a.src = src;
    setPlayingId(id);
    void a.play().catch(() => setPlayingId(null));
  };

  const enabledCount = account.voices.filter((voice) => voice.enabled).length;
  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0;

  const save = () => {
    if (!canSave) return;
    void addVoice({ name: trimmedName, accent, enabled: true, sampleSeconds: 0 }).then(() => {
      setName("");
      setAccent(ACCENTS[0]);
      setAdding(false);
    });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Voices</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {enabledCount} of {account.voices.length} enabled
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>Add voice</Button>
      </header>

      <audio ref={previewRef} className="hidden" onEnded={() => setPlayingId(null)} />

      <Card>
        <CardHead title="All voices" hint="Turn a voice off without deleting it" />
        <ul className="divide-y divide-line">
          {account.voices.map((voice) => {
            const active = voice.id === account.defaultVoiceId;
            return (
              <li key={voice.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                <Switch
                  checked={voice.enabled}
                  onChange={(next) => void setVoiceEnabled(voice.id, next)}
                  label={`${voice.enabled ? "Disable" : "Enable"} ${voice.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="truncate">{voice.name}</span>
                    {active && <Badge tone="ember">Default</Badge>}
                    <Badge tone={voice.enabled ? "green" : "neutral"}>
                      {voice.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">
                    {voice.accent} · {voice.builtIn ? "built-in" : "added voice"}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {voice.sampleUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => preview(voice.id, `${gateway.base}${voice.sampleUrl}`)}
                    >
                      {playingId === voice.id ? "Stop" : "Preview"}
                    </Button>
                  )}
                  {voice.enabled && !active && (
                    <Button size="sm" onClick={() => useVoice(voice.id)}>
                      Use
                    </Button>
                  )}
                {!voice.builtIn && (
                  <Button variant="ghost" size="sm" onClick={() => void deleteVoice(voice.id)}>
                    Remove
                  </Button>
                )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Modal
        open={adding}
        onClose={() => {
          setAdding(false);
          setName("");
          setAccent(ACCENTS[0]);
        }}
        title="Add a voice"
      >
        <div className="space-y-4">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Voice name"
            aria-label="Voice name"
          />
          <Select value={accent} onChange={(event) => setAccent(event.target.value)} aria-label="Accent">
            {ACCENTS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setName("");
                setAccent(ACCENTS[0]);
              }}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={!canSave}>
              Save voice
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
