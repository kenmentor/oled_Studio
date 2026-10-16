"use client";

/* Anonymous page-view beacon. Fire-and-forget (keepalive) on every route
 * change — the backend only stores the path, no identity, no cookies read.
 * Mounted once in the root layout so landing, signin, and app pages count. */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { gateway } from "@/lib/gateway";

export default function VisitTracker() {
  const path = usePathname();
  const last = useRef("");

  useEffect(() => {
    if (!path || path === last.current) return;
    last.current = path;
    try {
      fetch(`${gateway.base}/v1/metrics/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* stats must never break browsing */
    }
  }, [path ]);

  return null;
}
