"use client";

/* Playground content: copy-paste snippets per language. EVERY tab runs
 * the REAL request underneath (same live fetch/WebSocket call, real wallet
 * debit on speech) — only the terminal costume differs per language.
 * Secrets never appear in snippets — always a YOUR_API_KEY placeholder. */

export type Lang = "curl" | "javascript" | "python" | "sdk";
export type Endpoint = "health" | "voices" | "speech";
export type JsMode = "rest" | "ws";

export const LANG_LABEL: Record<Lang, string> = {
  curl: "cURL",
  javascript: "JavaScript",
  python: "Python",
  sdk: "Python SDK",
};

export const ENDPOINT_LABEL: Record<Endpoint, string> = {
  health: "GET /health",
  voices: "GET /v1/voices",
  speech: "POST /v1/speech",
};

/** Standard-doc block rendered under the editor for each request. */
export const ENDPOINT_DOCS: Record<
  Endpoint,
  { method: "GET" | "POST"; path: string; about: string; params: { name: string; type: string; desc: string }[]; auth: string; response: string }
> = {
  health: {
    method: "GET",
    path: "/health",
    about: "Engine heartbeat. Tells you the provider, model version, sample rate and how many voices are loaded — before you spend a single token.",
    params: [],
    auth: "None. Safe to call from anywhere, as often as you like.",
    response: '{ "ok": true, "provider": "piper-standin-0.1.0", "voices": 4, "sample_rate": 24000 }',
  },
  voices: {
    method: "GET",
    path: "/v1/voices",
    about: "Lists every voice the engine can render right now, with accents and preview-clip URLs. Disabled voices reject synthesis with voice_disabled.",
    params: [],
    auth: "None. Voice ids from here plug straight into speech calls.",
    response: '{ "voices": [{ "id": "ada", "label": "Ada", "accent": "Nigerian · Igbo" }], "model_version": "…" }',
  },
  speech: {
    method: "POST",
    path: "/v1/speech",
    about: "Renders text into one complete WAV (HTTPS) or streams it sentence-by-sentence over /v1/talk (WS toggle). 1 character costs 1 token from the key owner's wallet — unless preview is on: ≤200 chars render free and are never billed.",
    params: [
      { name: "text", type: "string · 1–2000 chars", desc: "What gets spoken. What you type in the editor is what renders." },
      { name: "voice_id", type: "string · optional", desc: "Defaults to your console voice. Unknown ids 404, disabled ids 400." },
      { name: "session_id", type: "string · optional", desc: "Ephemeral generation session; created if omitted." },
    ],
    auth: "Bearer oled_sk_live_… key. Answer carries X-Balance-Chars with your new balance.",
    response: "audio/wav bytes + X-Balance-Chars header (or WS binary frames + done frame).",
  },
};

/** Read the speech inputs back OUT of edited editor code, so Run speaks
 *  exactly what the user typed in the recipe (fallback: sidebar inputs).
 *  One capture group per pattern — no fragile group counting. */
export function extractSpeech(code: string): { text?: string; voiceId?: string } {
  // Shell snippets escape quotes (\"text\": \"...\") — flatten those first
  // so one pattern set reads every language. Remaining \n stays meaningful.
  const src = code.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const unescape = (s: string) =>
    s.replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  const TEXT_RES = [
    /["']text["']\s*:\s*"((?:[^"\\\n]|\\.)*)"/m, // "text": "..." (curl/python)
    /["']text["']\s*:\s*'((?:[^'\\\n]|\\.)*)'/m, // 'text': '...'
    /\btext\s*[:=]\s*"((?:[^"\\\n]|\\.)*)"/m, // text: "..." / text = "..."
    /\btext\s*[:=]\s*'((?:[^'\\\n]|\\.)*)'/m,
    /\btext\s*[:=]\s*`((?:[^`\\]|\\.)*)`/m, // text: `...` (js template)
    /\bspeech(?:_stream)?\(\s*"((?:[^"\\\n]|\\.)*)"/m, // sdk speech("...")
    /\bspeech(?:_stream)?\(\s*'((?:[^'\\\n]|\\.)*)'/m,
  ];
  const VOICE_RES = [
    /voice_id["']?\s*[:=]\s*"((?:[^"\\\n]|\\.)*)"/m,
    /voice_id["']?\s*[:=]\s*'((?:[^'\\\n]|\\.)*)'/m,
    /--voice\s+(\S+)/m, // sdk --voice flag
  ];
  let text: string | undefined;
  for (const re of TEXT_RES) {
    const m = re.exec(src);
    if (m) {
      text = unescape(m[1]);
      break;
    }
  }
  let voiceId: string | undefined;
  for (const re of VOICE_RES) {
    const m = re.exec(src);
    if (m) {
      voiceId = unescape(m[1]);
      break;
    }
  }
  return {
    ...(text !== undefined && text !== "" ? { text } : {}),
    ...(voiceId !== undefined && voiceId !== "" ? { voiceId } : {}),
  };
}

export interface SnippetCtx {
  base: string;
  wsBase: string;
  text: string;
  voiceId: string;
}

const q = (s: string) => JSON.stringify(s);

export function buildSnippet(lang: Lang, endpoint: Endpoint, ctx: SnippetCtx): { code: string; editorLang: "bash" | "javascript" | "python" } {
  const { base, wsBase, text, voiceId } = ctx;
  if (lang === "curl") {
    if (endpoint === "health") return { editorLang: "bash", code: `# no auth needed — anyone can ask if the engine is awake\ncurl ${base}/health` };
    if (endpoint === "voices")
      return { editorLang: "bash", code: `# list every voice the engine can render\ncurl ${base}/v1/voices` };
    const body = JSON.stringify({ text, voice_id: voiceId }).replace(/"/g, '\\"');
    return {
      editorLang: "bash",
      code: `# render text -> one complete WAV (headers carry the receipt)\n# YOUR_API_KEY: an oled_sk_live_… key from the API keys page\ncurl -X POST ${base}/v1/speech \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d "${body}" \\\n  --output speech.wav\n\n# the server answers audio/wav + X-Balance-Chars with your new balance`,
    };
  }
  if (lang === "javascript") {
    if (endpoint === "health")
      return {
        editorLang: "javascript",
        code: `// no auth needed — ping the engine\nconst res = await fetch(\`${base}/health\`);\nconst health = await res.json();\nconsole.log(health);\n// → { ok: true, provider: "piper-standin-0.1.0", voices: 4, ... }`,
      };
    if (endpoint === "voices")
      return {
        editorLang: "javascript",
        code: `// list every voice the engine can render\nconst res = await fetch(\`${base}/v1/voices\`);\nconst { voices } = await res.json();\nfor (const v of voices) console.log(v.id, "-", v.label);`,
      };
    return {
      editorLang: "javascript",
      code: `// render text -> one complete WAV. Runs LIVE when you press Run.\nconst API_KEY = process.env.OLED_API_KEY; // oled_sk_live_…\nconst res = await fetch(\`${base}/v1/speech\`, {\n  method: "POST",\n  headers: {\n    "Authorization": \`Bearer \${API_KEY}\`,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({ text: ${q(text)}, voice_id: "${voiceId}" }),\n});\nif (!res.ok) throw new Error(\`render failed: \${res.status}\`);\nconst wav = await res.arrayBuffer(); // audio/wav — save or play it\nconsole.log("balance:", res.headers.get("x-balance-chars"));`,
    };
  }
  if (lang === "python") {
    if (endpoint === "health")
      return {
        editorLang: "python",
        code: `# pip install requests\nimport requests\n\n# no auth needed — ping the engine\nr = requests.get(f"${base}/health", timeout=10)\nprint(r.json())\n# → {'ok': True, 'provider': 'piper-standin-0.1.0', 'voices': 4, ...}`,
      };
    if (endpoint === "voices")
      return {
        editorLang: "python",
        code: `# pip install requests\nimport requests\n\n# list every voice the engine can render\nr = requests.get(f"${base}/v1/voices", timeout=10)\nfor v in r.json()["voices"]:\n    print(v["id"], "-", v["label"])`,
      };
    return {
      editorLang: "python",
      code: `# pip install requests\nimport os\nimport requests\n\nAPI_KEY = os.environ["OLED_API_KEY"]  # oled_sk_live_…\nr = requests.post(\n    f"${base}/v1/speech",\n    headers={"Authorization": f"Bearer {API_KEY}"},\n    json={"text": ${q(text)}, "voice_id": "${voiceId}"},\n    timeout=120,\n)\nr.raise_for_status()  # the body IS the WAV — save it below\nopen("speech.wav", "wb").write(r.content)\nprint("balance:", r.headers.get("x-balance-chars"))`,
    };
  }
  // sdk — our first-party `oled` package shape (simulated here).
  if (endpoint === "health")
    return {
      editorLang: "python",
      code: `# pip install oled-studio\nfrom oled import Studio\n\nstudio = Studio()  # reads OLED_API_KEY; health needs no key\nprint(studio.health())\n# → {'ok': True, 'voices': 4, 'model_version': 'piper-standin-0.1.0'}`,
    };
  if (endpoint === "voices")
    return {
      editorLang: "python",
      code: `# pip install oled-studio\nfrom oled import Studio\n\nstudio = Studio()  # reads OLED_API_KEY; voices need no key\nfor v in studio.voices():\n    print(v.id, "-", v.label, f"({v.accent})")`,
    };
  return {
    editorLang: "python",
    code: `# pip install oled-studio\nfrom oled import Studio\n\nstudio = Studio()  # reads OLED_API_KEY (oled_sk_live_…)\nclip = studio.speech(${q(text)}, voice_id="${voiceId}")\nclip.save("speech.wav")  # or clip.play() to hear it now\nprint(f"{clip.seconds:.1f}s audio · balance {clip.balance} tokens")`,
  };
}

/** One-line install for the bar above the editor (curl/js need nothing). */
export const INSTALL_CMD: Record<Lang, string> = {
  curl: "# nothing to install — curl ships with macOS, Linux & Windows 10+",
  javascript: "// nothing to install — fetch + WebSocket are built into browsers & node 18+",
  python: "pip install requests websockets",
  sdk: "pip install oled-studio",
};

/** Streaming (/v1/talk) snippet per language. cURL can't stream sockets. */
export function buildWsSnippet(lang: Exclude<Lang, "curl">, ctx: SnippetCtx): string {
  const { wsBase, text, voiceId } = ctx;
  if (lang === "python")
    return `# pip install websockets\nimport asyncio\nimport json\n\n# STREAMING: first audio after sentence one, the rest keeps flowing.\nasync def main():\n    async with websockets.connect("${wsBase}/v1/talk") as ws:\n        await ws.send(json.dumps({\n            "type": "speak",\n            "request_id": "r-1",\n            "text": ${q(text)},\n            "voice_id": "${voiceId}",\n            "api_key": os.environ["OLED_API_KEY"],  # oled_sk_live_…\n        }))\n        chunks = []\n        async for msg in ws:\n            if isinstance(msg, bytes):\n                chunks.append(msg)  # audio — play it live!\n                continue\n            m = json.loads(msg)\n            if m["type"] == "done":\n                print(f"done: {m['bytes']} bytes, balance {m['balance_chars']}")\n                break\n            if m["type"] == "error":\n                raise RuntimeError(m["code"] + ": " + m["message"])\n\nimport os\nimport websockets\nasyncio.run(main())`;
  if (lang === "sdk")
    return `# pip install oled-studio\nfrom oled import Studio\n\nstudio = Studio()  # reads OLED_API_KEY (oled_sk_live_…)\n# STREAMING: frames yield live — first audio after sentence one.\nstream = studio.speech_stream(${q(text)}, voice_id="${voiceId}")\nframes = []\nfor n, frame in enumerate(stream):\n    frames.append(frame)\n    if n == 0:\n        print("first audio — still rendering the rest…")\nclip = stream.collect(frames)\nclip.save("speech.wav")\nprint(f"done: {clip.bytes} bytes, balance {clip.balance} tokens")`;
  return `// STREAMING: text in, chunked WAV back on one socket. Runs LIVE on Run.
// First audio lands after the first sentence — the rest keeps flowing.
const ws = new WebSocket("${wsBase}/v1/talk");
ws.binaryType = "arraybuffer";
const chunks = []; // collect binary frames; frame[0] is the WAV header

ws.onopen = () => ws.send(JSON.stringify({
  type: "speak",
  request_id: "r-" + Math.random().toString(36).slice(2),
  text: ${q(text)},
  voice_id: "${voiceId}",
  api_key: process.env.OLED_API_KEY, // oled_sk_live_…
}));

ws.onmessage = (ev) => {
  if (typeof ev.data !== "string") return chunks.push(ev.data); // audio!
  const msg = JSON.parse(ev.data);
  if (msg.type === "done") {
    const wav = new Blob(chunks, { type: "audio/wav" });
    console.log(\`done: \${msg.bytes} bytes, balance \${msg.balance_chars}\`);
    ws.close();
  }
  if (msg.type === "error") throw new Error(msg.code + ": " + msg.message);
};`;
}

/* ---- terminal ---- */

export interface TermLine {
  text: string;
  tone: "cmd" | "ok" | "err" | "info" | "dim";
}

/** The `$ ...` line each tab prints — every tab runs the REAL request
 *  underneath (same JS engine call), only the costume differs. */
export function cmdFor(lang: Lang, endpoint: Endpoint, ctx: SnippetCtx, ws: boolean): string {
  if (lang === "curl") {
    if (endpoint === "health") return `curl ${ctx.base}/health`;
    if (endpoint === "voices") return `curl ${ctx.base}/v1/voices`;
    return `curl -X POST ${ctx.base}/v1/speech -H "Authorization: Bearer ••••" -H "Content-Type: application/json" -d '{…}' --output speech.wav`;
  }
  if (lang === "python") {
    if (endpoint === "health") return `python -c "import requests; print(requests.get('${ctx.base}/health').json())"`;
    if (endpoint === "voices") return `python render.py  # GET /v1/voices`;
    return ws
      ? `python stream.py  # WS ${ctx.wsBase}/v1/talk (streaming)`
      : `python render.py  # POST /v1/speech (${ctx.text.length} chars, ${ctx.voiceId})`;
  }
  if (lang === "sdk") {
    if (endpoint === "health") return `oled health`;
    if (endpoint === "voices") return `oled voices`;
    const short = `"${ctx.text.slice(0, 28)}${ctx.text.length > 28 ? "…" : ""}" --voice ${ctx.voiceId}`;
    return ws ? `oled speech ${short} --stream` : `oled speech ${short}`;
  }
  // javascript
  if (endpoint === "health") return `node -e "fetch('${ctx.base}/health').then(r=>r.json()).then(console.log)"`;
  if (endpoint === "voices") return `node render.mjs  # GET /v1/voices`;
  return ws ? `node render.mjs  # WS ${ctx.wsBase}/v1/talk (streaming)` : `node render.mjs  # POST /v1/speech`;
}

/** Autocomplete entries for the editor (Ctrl+Space). */
export function completeFor(lang: "bash" | "javascript" | "python"): { name: string; detail: string }[] {
  const shared = [
    { name: "voice_id", detail: "string · e.g. \"ada\" — see voices list" },
    { name: "OLED_API_KEY", detail: "env · an oled_sk_live_… secret" },
    { name: "balance_chars", detail: "number · wallet left after render" },
  ];
  if (lang === "bash")
    return [
      { name: "curl", detail: "cmd · transfer a URL" },
      { name: "--output", detail: "flag · write body to file" },
      { name: "-H", detail: "flag · header, e.g. Authorization" },
      ...shared,
    ];
  if (lang === "python")
    return [
      { name: "requests.post", detail: "fn · POST + json body" },
      { name: "requests.get", detail: "fn · GET" },
      { name: "raise_for_status", detail: "fn · throw on HTTP error" },
      { name: "Studio", detail: "class · from oled import Studio" },
      ...shared,
    ];
  return [
    { name: "fetch", detail: "fn · promise-based HTTP" },
    { name: "WebSocket", detail: "class · streaming /v1/talk" },
    { name: "arrayBuffer", detail: "fn · read binary body" },
    ...shared,
  ];
}
