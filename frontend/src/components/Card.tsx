import type { ReactNode } from "react";

export function Card({ title, children, actions, className = "" }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-[#111a2e] p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-slate-200">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="rounded border border-red-800 bg-red-950/50 p-2 text-sm text-red-300">{(error as Error).message}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-slate-500">{children}</p>;
}

export const btn = "rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50";
export const input = "rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100";

export function Tile({ label, value, tone = "text-slate-100" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
