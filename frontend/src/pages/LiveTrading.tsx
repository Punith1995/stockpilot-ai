import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { LiveGates } from "../types";
import { Badge } from "../components/Badge";
import { Card, ErrorBox } from "../components/Card";

/** Shows the safety gates. The order button is intentionally absent: live trading is not implemented. */
export function LiveTrading() {
  const q = useQuery({ queryKey: ["live"], queryFn: () => api<LiveGates>("/live/status"), refetchInterval: 30_000 });
  return (
    <Card title="Live trading · safety gates">
      <div className="mb-3 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
        Live trading is disabled and not implemented in this version. No orders can be placed from this app.
      </div>
      <ErrorBox error={q.error} />
      {q.data && (
        <>
          <ul className="space-y-2 text-sm">
            {q.data.gates.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-3 rounded border border-slate-800 p-2">
                <span>{g.label}{g.detail && <span className="block text-xs text-slate-500">{g.detail}</span>}</span>
                <Badge tone={g.ok ? "green" : "red"}>{g.ok ? "pass" : "fail"}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">{q.data.note}</p>
        </>
      )}
    </Card>
  );
}
