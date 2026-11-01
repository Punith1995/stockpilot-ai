import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { btn, Card, ErrorBox } from "./Card";

interface Check { name: string; ok: boolean; detail: string; ms: number }
interface Diagnose { connected: boolean; checks: Check[]; note: string }

/** Calls each Kite endpoint once and shows the result. Use right after logging in. */
export function DiagnosticCard() {
  const adminToken = useAdmin((s) => s.adminToken);
  const run = useMutation({ mutationFn: () => api<Diagnose>("/broker/diagnose", { adminToken }) });
  const data = run.data;
  return (
    <Card title="Kite connection check" actions={<button className={btn} disabled={!adminToken || run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Checking…" : "Run check"}</button>}>
      <p className="mb-3 text-xs text-slate-400">Calls each Kite endpoint once and shows what came back. Use this after you log in to find which call fails.</p>
      {!adminToken && <p className="text-xs text-amber-200">Enter the admin token above to run the check.</p>}
      {run.error && <ErrorBox error={run.error} />}
      {data && !data.connected && <p className="text-sm text-amber-200">{data.note}</p>}
      {data && data.checks.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Check</th><th>Result</th><th>Detail</th><th>ms</th></tr></thead>
          <tbody>
            {data.checks.map((c) => (
              <tr key={c.name} className="border-t border-slate-800">
                <td className="py-1.5">{c.name}</td>
                <td className={c.ok ? "text-emerald-300" : "text-red-300"}>{c.ok ? "OK" : "Failed"}</td>
                <td className="text-slate-300">{c.detail}</td>
                <td className="text-slate-500">{c.ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && <p className="mt-2 text-xs text-slate-500">{data.note}</p>}
    </Card>
  );
}
