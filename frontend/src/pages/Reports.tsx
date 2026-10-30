import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtIst, fmtMoney, fmtPct } from "../lib/format";
import type { BacktestResult } from "../types";
import { Card, Empty, ErrorBox } from "../components/Card";

function downloadCsv(run: BacktestResult) {
  const header = "exit_time_ist,symbol,qty,entry,exit,reason,net_pnl,r_multiple,bars_held";
  const rows = run.trades.map((t) => [new Date(t.exitTime + 19_800_000).toISOString().replace("T", " ").slice(0, 16), t.symbol, t.qty, t.entryPrice, t.exitPrice, t.exitReason, t.netPnl, t.rMultiple, t.barsHeld].join(","));
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `backtest-${run.id}-${run.symbol}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const q = useQuery({ queryKey: ["backtests"], queryFn: () => api<{ items: BacktestResult[] }>("/backtests") });
  const items = [...(q.data?.items ?? [])].reverse();
  return (
    <Card title="Reports · backtest history · SAMPLE">
      <ErrorBox error={q.error} />
      {q.data && !items.length && <Empty>No backtests yet. Run one on the Backtest page.</Empty>}
      {items.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Run</th><th>Symbol</th><th>Trades</th><th>Win rate</th><th>Net profit</th><th>Max DD</th><th>Walk-forward</th><th></th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="py-1.5">{r.id} · {fmtIst(new Date(r.createdAt).getTime())}</td><td>{r.symbol}</td><td>{r.metrics.trades}</td>
                <td>{fmtPct(r.metrics.winRate)}</td><td>{fmtMoney(r.metrics.netProfit)}</td><td>{fmtPct(r.metrics.maxDrawdownPct)}</td>
                <td>{r.walkForward ? `OOS ${fmtMoney(r.walkForward.outOfSample.metrics.netProfit)}` : "—"}</td>
                <td><button className="text-sky-400 underline" onClick={() => downloadCsv(r)} disabled={!r.trades.length}>CSV</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-slate-500">Backtests are in memory and reset on restart. CSV contains trades from the stored run (latest 100).</p>
    </Card>
  );
}
