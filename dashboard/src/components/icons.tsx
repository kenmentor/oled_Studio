"use client";

/* Icons as inline SVG paths. A dependency here would cost more than the
 * twenty glyphs this app actually uses. */

type P = { className?: string };

const base = "size-4 shrink-0";

function Svg({ className, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? base}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconOverview = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Svg>
);

export const IconStudio = (p: P) => (
  <Svg {...p}>
    <path d="M3 12h2l2-6 3 14 3-11 2.5 7 1.5-4H21" />
  </Svg>
);

export const IconVoices = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);

export const IconKeys = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="12" r="4" />
    <path d="M12 12h9M18 12v3M15 12v2" />
  </Svg>
);

export const IconUsage = (p: P) => (
  <Svg {...p}>
    <path d="M4 19V5M4 19h16" />
    <path d="M8 15V9M12 15V6M16 15v-4" />
  </Svg>
);

export const IconBilling = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3 10h18M7 15h3" />
  </Svg>
);

export const IconSettings = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h9M17 17h3" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="15" cy="17" r="2" />
  </Svg>
);

export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 13 4 4L19 7" />
  </Svg>
);

export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M8 11l4 4 4-4M5 19h14" />
  </Svg>
);

export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </Svg>
);

export const IconSignOut = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4" />
  </Svg>
);

export const IconMic = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);

export const IconUpload = (p: P) => (
  <Svg {...p}>
    <path d="M12 16V5M8 9l4-4 4 4M5 19h14" />
  </Svg>
);

export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M8 5v14l11-7z" />
  </Svg>
);

export const IconSpark = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </Svg>
);

export const IconArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const IconDocs = (p: P) => (
  <Svg {...p}>
    <path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Zm0 0a2 2 0 0 0 2 2h13" />
    <path d="M9 8h6M9 12h4" />
  </Svg>
);

export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" />
    <path d="m9.5 12 2 2 3.5-4" />
  </Svg>
);

export const IconFiles = (p: P) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Svg>
);

export const IconTerminal = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M12 15h5" />
  </Svg>
);

export const IconWarn = (p: P) => (
  <Svg {...p}>
    <path d="M12 4 2.5 20h19z" />
    <path d="M12 10v4M12 17.5v.5" />
  </Svg>
);

/* File-type icons in the Seti (VS Code) style: document silhouette in the
 * language's brand colors with its short label. */
function DocIcon({
  className,
  body,
  fold,
  label,
  labelFill,
}: P & { body: string; fold: string; label: string; labelFill: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`size-4 shrink-0 ${className ?? ""}`} aria-hidden="true">
      <path
        d="M4 1h5l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"
        fill={body}
      />
      <path d="M9 1l3 3H9z" fill={fold} />
      <text
        x="8"
        y="12.2"
        textAnchor="middle"
        fontFamily="Consolas, monospace"
        fontSize="5.2"
        fontWeight="bold"
        fill={labelFill}
      >
        {label}
      </text>
    </svg>
  );
}

export const IconFileJs = (p: P) => (
  <DocIcon {...p} body="#f7df1e" fold="#d8bd0e" label="JS" labelFill="#000" />
);
export const IconFilePy = (p: P) => (
  <svg viewBox="0 0 16 16" className={`size-4 shrink-0 ${p.className ?? ""}`} aria-hidden="true">
    <path d="M4 1h5l3 3v4H4z" fill="#3776a0" />
    <path d="M9 1l3 3H9z" fill="#2b5b84" />
    <path d="M4 8h8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8z" fill="#ffd43b" />
    <text x="8" y="12.4" textAnchor="middle" fontFamily="Consolas, monospace" fontSize="5" fontWeight="bold" fill="#333">
      Py
    </text>
  </svg>
);
export const IconFileSh = (p: P) => (
  <DocIcon {...p} body="#3b3b3b" fold="#555" label="$_" labelFill="#4ec9b0" />
);
export const IconFileSdk = (p: P) => (
  <DocIcon {...p} body="#ff4d00" fold="#b23400" label="⬢" labelFill="#000" />
);

export const IconGithub = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={p.className ?? base} aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);
