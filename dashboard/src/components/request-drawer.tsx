"use client";

import { Badge, Button, Drawer, Facts, SectionLabel } from "@/components/ui";
import { dateTime, duration, latency, compact, timeAgo, type UsageEvent } from "@/lib/store";
import { gateway } from "@/lib/gateway";

/* One request, opened from anywhere. Kept in its own file so Overview and
 * Usage describe a request the same way. */
export default function RequestDrawer({
  event,
  onClose,
}: {
  event: UsageEvent | null;
  onClose: () => void;
}) {
  if (!event) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title="Request"
      subtitle={`${event.id} · ${dateTime(event.at)}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="tabular font-mono text-xs text-zinc-500">
            {compact(event.characters)} tokens
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Badge tone={event.status === "done" ? "green" : "red"}>
            {event.status === "done" ? "rendered" : "failed"}
          </Badge>
          <Badge tone="neutral">{event.mode}</Badge>
          <Badge tone="neutral">{timeAgo(event.at)}</Badge>
        </div>

        <div>
          <SectionLabel>Text</SectionLabel>
          <p className="mt-2 rounded-md border border-line bg-surface p-3 text-sm leading-relaxed text-zinc-300">
            {event.text}
          </p>
        </div>

        <div>
          <SectionLabel>Timing</SectionLabel>
          <div className="mt-2">
            <Facts
              items={[
                { label: "First audio", value: latency(event.latencyMs) },
                { label: "Audio length", value: event.audioSeconds ? duration(event.audioSeconds) : "—" },
                { label: "Characters", value: event.characters.toLocaleString("en-US") },
              ]}
            />
          </div>
        </div>

        <div>
          <SectionLabel>Routed to</SectionLabel>
          <div className="mt-2">
            <Facts
              items={[
                { label: "Voice", value: event.voiceName },
                { label: "Key", value: event.keyName },
                { label: "Gateway", value: `${gateway.base.replace(/^http/, "ws")}/v1/talk` },
              ]}
            />
          </div>
        </div>

        <div>
          <SectionLabel>Audio</SectionLabel>
          <p className="mt-2 text-xs leading-relaxed text-zinc-600">
            Rendered audio isn&apos;t kept after playback in this demo build. The real gateway
            holds every render for 30 days and streams it back from here.
          </p>
        </div>
      </div>
    </Drawer>
  );
}
