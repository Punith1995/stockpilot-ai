import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { StrategyInfo } from "../types";
import { Badge } from "../components/Badge";
import { Card, ErrorBox } from "../components/Card";

export function Strategy() {
  const q = useQuery({ queryKey: ["strategies"], queryFn: () => api<StrategyInfo>("/strategies") });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <p className="text-sm text-slate-500">Loading…</p>;
  const cfg = q.data.config;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={q.data.name}>
        <p className="mb-3 text-sm text-slate-400">{q.data.note}</p>
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(cfg).filter(([k]) => k !== "conditions").map(([k, v]) => (
              <tr key={k} className="border-t border-slate-800"><td className="py-1.5 text-slate-400">{k}</td><td className="text-right">{String(v)}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Conditions">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500"><tr><th className="py-1 text-left">Condition</th><th>Enabled</th><th>Mandatory</th></tr></thead>
          <tbody>
            {Object.entries(cfg.conditions).map(([id, c]) => (
              <tr key={id} className="border-t border-slate-800">
                <td className="py-1.5">{q.data.labels[id] ?? id}</td>
                <td className="text-center">{c.enabled ? <Badge tone="green">on</Badge> : <Badge tone="slate">off</Badge>}</td>
                <td className="text-center">{c.mandatory ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">Read-only in this version. Parameters are defined in backend/src/strategy/ema-momentum-pro.ts.</p>
      </Card>
    </div>
  );
}
