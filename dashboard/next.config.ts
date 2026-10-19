import type { NextConfig } from "next";

// Split-server mode: this frontend runs as its own process
// (`npm run dev` on :3001, or its own host in prod) and talks to the
// FastAPI backend on :8000 cross-origin (see NEXT_PUBLIC_MIDDLEMAN_URL).
// The backend never serves these pages.

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
