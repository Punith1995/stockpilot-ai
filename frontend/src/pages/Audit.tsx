import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtIst } from "../lib/format";
import { useAdmin } from "../lib/store";
import type { AuditEntry } from "../types";
import { Badge } from "../components/Badge";
import { Card, Empty, ErrorBox } from "../components/Card";

export function Audit() {
  const adminToken = useAdmin((s) => s.adminToken);
  const q = useQuery({
    queryKey: ["audit", adminToken],
    queryFn: () => api<{ items: AuditEntry[]; note: string }>("/audit", { adminToken }),
    enabled: Boolean(adminToken),
    refetchInterval: 15_000,
  });
  return (
    <Card title="Audit log · admin actions">
      {!adminToken && <p className="text-sm text-amber-300">Enter the admin token on the Connection page to view the audit log.</p>}
      <ErrorBox error={q.error} />
      {q.data && (q.data.items.length === 0 ? <Empty>No admin actions yet.</Empty> : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">When (IST)</th><th>Action</th><th>Target</th><th>Outcome</th></tr></thead>
          <tbody>
            {q.data.items.map((e, i) => (
              <tr key={i} className="border-t border-slate-800"><td className="py-1.5">{fmtIst(new Date(e.at).getTime())}</td><td>{e.action}</td><td className="text-slate-400">{e.target ?? "—"}</td><td><Badge tone={e.outcome === "OK" ? "green" : "red"}>{e.outcome}</Badge></td></tr>
            ))}
          </tbody>
        </table>
      ))}
      <p className="mt-3 text-xs text-slate-500">Tokens and request bodies are never recorded. The log is in memory and resets on restart.</p>
    </Card>
  );
}
