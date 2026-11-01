import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { btn, Card, ErrorBox } from "./Card";

interface ScanRow { symbol: string; signal: string; close: number | null; rsi14: number | null; adx14: number | null; relVolume: number | null }
interface ScanJob { id: string; status: "running" | "done" | "cancelled" | "failed"; total: number; done: number; failed: number; startedAt: string; finishedAt: string | null; interval: string; results: ScanRow[]; error: string | null }
interface ScanAll { kiteConnected: boolean; universeSize: number; job: ScanJob | null; note: string }

/** Button-started scan of every NSE equity on live Kite 1-minute history. Polls while a scan runs. */
export function FullScanCard() {
  const adminToken = useAdmin((s) => s.adminToken);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["scan-all"],
    queryFn: () => api<ScanAll>("/scanner/scan-all"),
    refetchInterval: (query) => (query.state.data?.job?.status === "running" ? 3000 : false),
  });
  const start = useMutation({
    mutationFn: (interval: string) => api<{ job: ScanJob }>("/scanner/scan-all", { method: "POST", adminToken, body: { interval } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scan-all"] }),
  });
  const cancel = useMutation({
    mutationFn: () => api("/scanner/scan-all/cancel", { method: "POST", adminToken }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scan-all"] }),
  });
  const data = q.data;
  const job = data?.job ?? null;
  const running = job?.status === "running";
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <Card title="Full NSE scan · live Kite" actions={<span className="text-xs text-slate-500">{data?.kiteConnected && data.universeSize ? `${data.universeSize} NSE equities` : "Needs Kite login"}</span>}>
      <p className="mb-3 text-xs text-slate-400">{data?.note ?? "Scans every NSE equity on live Kite 1-minute history. Takes about 12 minutes."}</p>
      {!adminToken && <p className="mb-3 text-xs text-amber-200">Enter the admin token in Settings to start a scan.</p>}
      {data && !data.kiteConnected && <p className="mb-3 text-xs text-amber-200">Log in to Kite first. The full scan needs live data.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={!adminToken || !data?.kiteConnected || running || start.isPending} onClick={() => start.mutate("5")}>
          {running ? "Scanning…" : "Scan all NSE stocks (5 min)"}
        </button>
        {running && <button className={btn} onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel</button>}
        {job && <span className="text-xs text-slate-400">{job.status === "running" ? `${job.done} of ${job.total} · ${pct}%` : `${job.status} · ${job.done} of ${job.total} checked${job.failed ? ` · ${job.failed} failed` : ""}`}</span>}
      </div>
      {running && <div className="mt-2 h-2 w-full rounded bg-slate-800"><div className="h-2 rounded bg-sky-500" style={{ width: `${pct}%` }} /></div>}
      {job?.error && <p className="mt-2 text-sm text-red-300">{job.error}</p>}
      {(start.error || cancel.error) && <ErrorBox error={start.error ?? cancel.error} />}
      {job && job.results.length > 0 && (
        <div className="mt-3 max-h-96 overflow-auto">
          <p className="mb-2 text-xs text-slate-500">{job.results.filter((r) => r.signal === "BUY").length} BUY signals of {job.results.length} stocks scored · started {new Date(job.startedAt).toLocaleTimeString("en-IN")}</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Stock</th><th>Signal</th><th>Close</th><th>RSI 14</th><th>ADX 14</th><th>Rel. vol</th></tr></thead>
            <tbody>
              {job.results.slice(0, 200).map((r) => (
                <tr key={r.symbol} className="border-t border-slate-800">
                  <td className="py-1.5 font-medium">{r.symbol}</td>
                  <td className={r.signal === "BUY" ? "text-emerald-300" : "text-slate-400"}>{r.signal}</td>
                  <td>{r.close ?? "—"}</td><td>{r.rsi14 ?? "—"}</td><td>{r.adx14 ?? "—"}</td><td>{r.relVolume ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {job.results.length > 200 && <p className="mt-2 text-xs text-slate-500">Showing the first 200. BUY rows are listed first.</p>}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Not a recommendation. Signals come from the EMA Momentum Pro rules.</p>
    </Card>
  );
}
