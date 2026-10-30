import type { ReactNode } from "react";

const TONES = {
  green: "bg-emerald-900/60 text-emerald-300 border-emerald-700",
  red: "bg-red-900/60 text-red-300 border-red-700",
  amber: "bg-amber-900/60 text-amber-300 border-amber-700",
  slate: "bg-slate-800 text-slate-300 border-slate-600",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <span className={`rounded border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}
