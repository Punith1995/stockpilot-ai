import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ScanRow, StrategyInfo } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, Empty, ErrorBox } from "../components/Card";
import { fmtMoney } from "../lib/format";

export function Scanner() {
  const labels = useQuery({ queryKey: ["strategies"], queryFn: () => api<StrategyInfo>("/strategies") });
  const scan = useMutation({ mutationFn: () => api<{ source: string; results: ScanRow[] }>("/scanner/run", { method: "POST", body: {} }) });
  const name = (id: string) => labels.data?.labels[id] ?? id;

  return (
    <Card title="Scanner · EMA Momentum Pro · SAMPLE data" actions={<button className={btn} onClick={() => scan.mutate()} disabled={scan.isPending}>{scan.isPending ? "Scanning…" : "Run scan"}</button>}>
      <ErrorBox error={scan.error} />
      {!scan.data && !scan.isPending && <Empty>Run a scan to evaluate the sample instruments against the latest closed bar.</Empty>}
      {scan.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="py-2">Symbol</th><th>Signal</th><th>Checks passed</th><th>Failed mandatory</th><th>Plan</th></tr>
            </thead>
            <tbody>
              {scan.data.results.map((r) => (
                <tr key={r.symbol} className="border-t border-slate-800">
                  <td className="py-2 font-medium">{r.symbol}</td>
                  <td><Badge tone={r.signal === "BUY" ? "green" : "slate"}>{r.signal}</Badge></td>
                  <td>{r.passedChecks}/{r.totalChecks}</td>
                  <td className="text-slate-400">{r.failedMandatory.length ? r.failedMandatory.map(name).join(", ") : "—"}</td>
                  <td className="text-slate-300">{r.plan ? `Entry ${fmtMoney(r.plan.entry)} · Stop ${fmtMoney(r.plan.stop)} · Target ${fmtMoney(r.plan.target)} · Qty ${r.plan.qty}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
