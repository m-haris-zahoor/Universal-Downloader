import { ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({ variant = "secondary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const v = {
    primary: "bg-accent text-accentfg hover:brightness-110 font-medium",
    secondary: "bg-surface2 border border-line text-fg hover:border-muted/50",
    ghost: "text-muted hover:text-fg hover:bg-surface2",
    danger: "text-err hover:bg-err/10",
  }[variant];
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 h-10 text-sm transition disabled:opacity-40 disabled:pointer-events-none cursor-pointer ${v} ${className}`} />;
}

export function IconButton({ title, className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return <button {...p} title={title} aria-label={title} className={`h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-fg hover:bg-surface2 transition disabled:opacity-40 cursor-pointer ${className}`} />;
}

export function Select({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs text-muted mb-1.5 block">{label}</span>
      <span className="relative block">
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          className="w-full h-10 rounded-xl bg-surface2 border border-line px-3 pr-9 text-sm outline-none focus:border-accent transition disabled:opacity-40">
          {children}
        </select>
        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      </span>
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-surface border border-line ${className}`}>{children}</div>;
}

export function Progress({ value, tone = "accent" }: { value: number; tone?: "accent" | "ok" | "warn" }) {
  const c = { accent: "bg-accent", ok: "bg-ok", warn: "bg-warn" }[tone];
  return (
    <div className="h-1.5 rounded-full bg-surface2 overflow-hidden">
      <motion.div className={`h-full rounded-full ${c}`} animate={{ width: `${Math.max(0, Math.min(100, value))}%` }} transition={{ ease: "easeOut", duration: 0.3 }} />
    </div>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`w-10 h-6 rounded-full p-0.5 transition cursor-pointer ${checked ? "bg-accent" : "bg-surface2 border border-line"}`}>
      <motion.span layout className={`block h-5 w-5 rounded-full ${checked ? "bg-accentfg ml-auto" : "bg-muted"}`} />
    </button>
  );
}

export function Empty({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 text-muted">
      <div className="h-12 w-12 rounded-2xl bg-surface border border-line flex items-center justify-center mb-4">{icon}</div>
      <div className="text-fg font-medium">{title}</div>
      <div className="text-sm mt-1">{hint}</div>
    </div>
  );
}

export function Thumb({ src, className = "" }: { src?: string | null; className?: string }) {
  return src
    ? <img src={src} alt="" referrerPolicy="no-referrer" className={`object-cover bg-surface2 ${className}`} />
    : <div className={`bg-surface2 ${className}`} />;
}
