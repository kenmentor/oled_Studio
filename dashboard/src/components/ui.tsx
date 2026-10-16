"use client";

/* Primitives sized for this app only. No variant system, no asChild, no
 * forwardRef ceremony — but enough shapes that no screen has to hand-roll
 * its own button, badge, sheet or toggle. */

import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "default" | "ghost" | "outline" | "danger";

export function Button({
  variant = "default",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-10 px-5 text-sm",
        variant === "default" && "bg-ember font-bold text-black hover:bg-ember/90",
        variant === "outline" && "border border-line bg-transparent hover:bg-surface-2",
        variant === "ghost" && "text-zinc-400 hover:bg-surface-2 hover:text-zinc-100",
        variant === "danger" && "border border-red-500/30 text-red-400 hover:bg-red-500/10",
        className
      )}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-sm placeholder:text-zinc-600 focus:border-ember/50",
        className
      )}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full resize-none rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm leading-relaxed placeholder:text-zinc-600 focus:border-ember/50",
        className
      )}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-9 w-full appearance-none rounded-md border border-line bg-surface-2 px-3 text-sm text-zinc-200 focus:border-ember/50",
        className
      )}
    >
      {children}
    </select>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-xl border border-line bg-surface", className)}>{children}</section>;
}

export function CardHead({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** A link that behaves like the quiet affordance it is. */
export function QuietLink({
  children,
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      className={cn(
        "font-mono text-[11px] text-zinc-500 transition-colors hover:text-ember",
        className
      )}
    >
      {children}
    </a>
  );
}

type Tone = "neutral" | "ember" | "gold" | "green" | "red";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        tone === "neutral" && "border-line text-zinc-500",
        tone === "ember" && "border-ember/30 bg-ember/10 text-ember",
        tone === "gold" && "border-gold/30 bg-gold/10 text-gold",
        tone === "green" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
        tone === "red" && "border-red-500/30 bg-red-500/10 text-red-400"
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "neutral" && "bg-zinc-600",
        tone === "ember" && "bg-ember",
        tone === "gold" && "bg-gold",
        tone === "green" && "bg-emerald-400",
        tone === "red" && "bg-red-400"
      )}
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 cursor-pointer rounded-full p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/60",
        checked ? "bg-ember" : "bg-zinc-700"
      )}
    >
      {/* Left-anchored with exact 20px travel (2px insets both sides, both
        states) so the knob can never drift; white knob reads on both tracks. */}
      <span
        className={cn(
          "absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

/** Label + description + control, the row shape used across Settings. */
export function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <p className="text-sm">{title}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-zinc-600">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-in relative max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface-2"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="min-w-0 break-words text-sm font-medium">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-zinc-600 transition-colors hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

/** The drill-down surface: everything detailed opens to the right, so the
 *  pages themselves stay short and the extra depth is always one click away. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-md flex-col overflow-hidden border-l border-line bg-surface-2"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 className="break-words text-sm font-medium">{title}</h2>
            {subtitle && <p className="mt-1 break-all font-mono text-[11px] text-zinc-600">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-zinc-600 transition-colors hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

/** Key/value pairs inside a drawer — the detail layout for every record. */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map((f) => (
        <div key={f.label} className="flex items-baseline justify-between gap-6 py-2.5">
          <dt className="shrink-0 text-xs text-zinc-600">{f.label}</dt>
          <dd className="tabular min-w-0 break-all text-right font-mono text-xs text-zinc-200">
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">{children}</p>
  );
}

/** Backend avatar when linked, initial letter otherwise. Never overflows. */
export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string;
  className?: string;
}) {
  const initial = (name.trim()[0] || "?").toUpperCase();
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn("size-8 shrink-0 rounded-full object-cover ring-1 ring-line", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-ember/15 font-display text-sm font-bold text-ember",
        className
      )}
    >
      {initial}
    </span>
  );
}
