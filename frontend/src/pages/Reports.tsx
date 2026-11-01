import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtIst, fmtMoney, fmtPct } from "../lib/format";
import type { BacktestResult, PaperReport } from "../types";
import { Card, Empty, ErrorBox, Tile, btn, input } from "../components/Card";
import { Pager, usePager } from "../components/Pager";
import { useDataSource } from "../lib/source";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function downloadBacktestCsv(run: BacktestResult) {
  const header = "exit_time_ist,symbol,qty,entry,exit,reason,net_pnl,r_multiple,bars_held";
  const rows = run.trades.map((t) => [new Date(t.exitTime + 19_800_000).toISOString().replace("T", " ").slice(0, 16), t.symbol, t.qty, t.entryPrice, t.exitPrice, t.exitReason, t.netPnl, t.rMultiple, t.barsHeld].join(","));
  download(`backtest-${run.id}-${run.symbol}.csv`, [header, ...rows].join("\n"));
}

const tone = (n: number) => (n < 0 ? "text-red-300" : "text-emerald-300");

export function Reports() {
  const src = useDataSource();
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const qs = new URLSearchParams({ period, ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const rep = useQuery({ queryKey: ["reports-paper", qs], queryFn: () => api<PaperReport>(`/reports/paper?${qs}`) });
  const bt = useQuery({ queryKey: ["backtests"], queryFn: () => api<{ items: BacktestResult[] }>("/backtests") });
  const runs = [...(bt.data?.items ?? [])].reverse();
  const pg = usePager([...(rep.data?.rows ?? [])].reverse());
  const r = rep.data;

  const exportCsv = () => {
    if (!r) return;
    const header = "period,trades,wins,losses,win_rate_pct,gross_pnl,costs,net_pnl,avg_win,avg_loss,max_drawdown";
    const lines = r.rows.map((x) => [x.label, x.trades, x.wins, x.losses, x.winRate, x.grossPnl, x.costs, x.netPnl, x.avgWin, x.avgLoss, x.maxDrawdown].join(","));
    download(`paper-report-${period}.csv`, [header, ...lines].join("\n"));
  };

  return (
    <div className="grid gap-4">
      <Card title="Report filters · paper trading · IST">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">Period<select className={`${input} mt-1 w-full`} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
          <label className="text-sm">From (exit date)<input className={`${input} mt-1 w-full`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-sm">To (exit date)<input className={`${input} mt-1 w-full`} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <div className="flex items-end gap-2">
            <button className={btn} onClick={exportCsv} disabled={!r?.rows.length}>Download CSV</button>
            <button className={btn} onClick={() => window.print()}>Print / save as PDF</button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Leave dates empty for all trades. Printing uses the browser's Save as PDF.</p>
      </Card>

      <ErrorBox error={rep.error ?? bt.error} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Trades in view" value={r?.totals.trades ?? "—"} />
        <Tile label="Net P&L" value={fmtMoney(r?.totals.netPnl ?? null)} tone={tone(r?.totals.netPnl ?? 0)} />
        <Tile label="Win rate" value={r ? fmtPct(r.totals.winRate) : "—"} />
        <Tile label="Max drawdown" value={fmtMoney(r?.totals.maxDrawdown ?? null)} />
      </div>

      <Card title="Risk report · paper account">
        {r ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Open positions" value={r.risk.openPositions} />
            <Tile label="Capital at risk" value={fmtMoney(r.risk.capitalAtRisk)} />
            <Tile label="Open exposure" value={fmtMoney(r.risk.exposure)} />
            <Tile label="Daily loss limit" value={fmtMoney(r.risk.dailyLossLimit)} />
            <Tile label="Today's realized" value={fmtMoney(r.risk.todayRealizedPnl)} tone={tone(r.risk.todayRealizedPnl)} />
            <Tile label="Daily loss limit used" value={fmtPct(r.risk.dailyLossUsedPct)} tone={r.risk.dailyLossUsedPct >= 100 ? "text-red-300" : undefined} />
          </div>
        ) : <Empty>Loading risk figures…</Empty>}
        <p className="mt-2 text-xs text-slate-500">Capital at risk is the rupee loss if every open stop is hit.</p>
      </Card>

      <Card title={`${period[0].toUpperCase()}${period.slice(1)} report · paper trades`}>
        {r && !r.rows.length && <Empty>No paper trades in this range. Close a paper position or scan first.</Empty>}
        {r && r.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Period</th><th>Trades</th><th>Wins</th><th>Losses</th><th>Win rate</th><th>Gross P&amp;L</th><th>Charges</th><th>Net P&amp;L</th><th>Avg win</th><th>Avg loss</th><th>Max DD</th></tr></thead>
              <tbody>
                {pg.slice.map((x) => (
                  <tr key={x.label} className="border-t border-slate-800">
                    <td className="py-1.5 whitespace-nowrap">{x.label}</td><td>{x.trades}</td><td>{x.wins}</td><td>{x.losses}</td><td>{fmtPct(x.winRate)}</td>
                    <td className={tone(x.grossPnl)}>{fmtMoney(x.grossPnl)}</td><td>{fmtMoney(x.costs)}</td><td className={tone(x.netPnl)}>{fmtMoney(x.netPnl)}</td>
                    <td>{fmtMoney(x.avgWin)}</td><td>{fmtMoney(x.avgLoss)}</td><td>{fmtMoney(x.maxDrawdown)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager {...pg} />
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">{r?.note}</p>
      </Card>

      <Card title={`Backtest reports · ${src.word}`}>
        <ErrorBox error={bt.error} />
        {bt.data && !runs.length && <Empty>No backtests yet. Run one on the Backtesting page.</Empty>}
        {runs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Run</th><th>Symbol</th><th>Trades</th><th>Win rate</th><th>Net profit</th><th>Max DD</th><th>Walk-forward</th><th></th></tr></thead>
              <tbody>
                {runs.map((x) => (
                  <tr key={x.id} className="border-t border-slate-800">
                    <td className="py-1.5">{x.id} · {fmtIst(new Date(x.createdAt).getTime())}</td><td>{x.symbol}</td><td>{x.metrics.trades}</td>
                    <td>{fmtPct(x.metrics.winRate)}</td><td>{fmtMoney(x.metrics.netProfit)}</td><td>{fmtPct(x.metrics.maxDrawdownPct)}</td>
                    <td>{x.walkForward ? `OOS ${fmtMoney(x.walkForward.outOfSample.metrics.netProfit)}` : "—"}</td>
                    <td><button className="text-sky-400 underline" onClick={() => downloadBacktestCsv(x)} disabled={!x.trades.length}>CSV</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">Backtests are in memory and reset on restart. CSV contains trades from the stored run (latest 100).</p>
      </Card>
    </div>
  );
}
