import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst, fmtMoney, REASON_LABELS } from "../lib/format";
import type { PaperSnapshot } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, Empty, ErrorBox } from "../components/Card";

export function PaperTrading() {
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const paper = useQuery({ queryKey: ["paper"], queryFn: () => api<PaperSnapshot>("/paper"), refetchInterval: 10_000 });
  const scan = useMutation({
    mutationFn: () => api("/paper/scan", { method: "POST", adminToken }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["paper"] }),
  });
  const stop = useMutation({
    mutationFn: (active: boolean) => api("/paper/emergency-stop", { method: "POST", adminToken, body: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["paper"] }),
  });
  const p = paper.data;

  return (
    <div className="grid gap-4">
      <Card title="Paper account · no real orders" actions={
        <div className="flex gap-2">
          <button className={btn} onClick={() => scan.mutate()} disabled={!adminToken || scan.isPending}>Scan sample data</button>
          <button className={btn} onClick={() => stop.mutate(!p?.emergencyStop)} disabled={!adminToken || stop.isPending}>
            {p?.emergencyStop ? "Clear emergency stop" : "Emergency stop + flatten"}
          </button>
        </div>
      }>
        {!adminToken && <p className="mb-2 text-sm text-amber-300">Enter the admin token on the Connection page to scan or change the stop.</p>}
        <ErrorBox error={paper.error ?? scan.error ?? stop.error} />
        {p && (
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><dt className="text-slate-400">Starting capital</dt><dd>{fmtMoney(p.startCapital)}</dd></div>
            <div><dt className="text-slate-400">Cash</dt><dd>{fmtMoney(p.cash)}</dd></div>
            <div><dt className="text-slate-400">Realized P&amp;L</dt><dd>{fmtMoney(p.realizedPnl)}</dd></div>
            <div><dt className="text-slate-400">Emergency stop</dt><dd>{p.emergencyStop ? <Badge tone="red">ON</Badge> : <Badge tone="green">Off</Badge>}</dd></div>
          </dl>
        )}
      </Card>

      <Card title="Open positions">
        {!p?.positions.length ? <Empty>No open paper positions.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Qty</th><th>Entry</th><th>Stop</th><th>Target</th></tr></thead>
            <tbody>{p.positions.map((x) => <tr key={x.symbol} className="border-t border-slate-800"><td className="py-1.5">{x.symbol}</td><td>{x.qty}</td><td>{fmtMoney(x.entry)}</td><td>{fmtMoney(x.stop)}</td><td>{fmtMoney(x.target)}</td></tr>)}</tbody>
          </table>
        )}
      </Card>

      <Card title="Orders (latest 50)">
        {!p?.orders.length ? <Empty>No paper orders yet. Run a scan.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">ID</th><th>Symbol</th><th>Status</th><th>Fill</th><th>Note</th></tr></thead>
            <tbody>{[...p.orders].reverse().map((o) => <tr key={o.id} className="border-t border-slate-800"><td className="py-1.5">{o.id}</td><td>{o.symbol}</td><td><Badge tone={o.status === "FILLED" ? "green" : o.status === "REJECTED" ? "red" : "amber"}>{o.status}</Badge></td><td>{o.fillPrice ? fmtMoney(o.fillPrice) : "—"}</td><td className="text-slate-400">{o.reason ?? ""}</td></tr>)}</tbody>
          </table>
        )}
      </Card>

      <Card title="Closed trades (latest 100)">
        {!p?.trades.length ? <Empty>No closed paper trades.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Reason</th><th>Net P&amp;L</th></tr></thead>
            <tbody>{[...p.trades].reverse().map((t, i) => <tr key={i} className="border-t border-slate-800"><td className="py-1.5">{t.symbol}</td><td>{t.qty}</td><td>{fmtMoney(t.entry)}</td><td>{fmtMoney(t.exit)}</td><td>{REASON_LABELS[t.reason] ?? t.reason}</td><td className={t.netPnl >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtMoney(t.netPnl)}</td></tr>)}</tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-slate-500">Paper P&amp;L only. Times are not shown here; see the Backtest page for timestamps. Last refresh {fmtIst(Date.now())}.</p>
      </Card>
    </div>
  );
}
