import type { ReactNode } from "react";

export function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="rounded border border-red-800 bg-red-950/50 p-2 text-sm text-red-300">{(error as Error).message}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

export const btn = "rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50";
export const input = "rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100";
