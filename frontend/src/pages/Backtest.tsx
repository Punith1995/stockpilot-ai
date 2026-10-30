import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst, fmtMoney, fmtNum, fmtPct, REASON_LABELS } from "../lib/format";
import type { BacktestResult, Instrument } from "../types";
import { btn, Card, Empty, ErrorBox, input } from "../components/Card";

export function Backtest() {
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const [symbol, setSymbol] = useState("TCS");
  const [days, setDays] = useState(40);
  const [product, setProduct] = useState<"DELIVERY" | "INTRADAY">("DELIVERY");
  const [oos, setOos] = useState(0);
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const history = useQuery({ queryKey: ["backtests"], queryFn: () => api<{ items: BacktestResult[] }>("/backtests") });
  const run = useMutation({
    mutationFn: () => api<BacktestResult>("/backtests", { method: "POST", adminToken, body: { symbol, days, productType: product, slippageBps: 5, oosFraction: oos } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backtests"] }),
  });
  const latest = run.data ?? history.data?.items.at(-1);

  return (
    <div className="grid gap-4">
      <Card title="Run backtest · SAMPLE data">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Symbol<br />
            <select className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}
            </select>
          </label>
          <label className="text-sm">Sessions<br /><input className={input} type="number" min={5} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
          <label className="text-sm">Product<br />
            <select className={input} value={product} onChange={(e) => setProduct(e.target.value as "DELIVERY" | "INTRADAY")}>
              <option value="DELIVERY">Delivery</option><option value="INTRADAY">Intraday</option>
            </select>
          </label>
          <label className="text-sm">Out-of-sample<br />
            <select className={input} value={oos} onChange={(e) => setOos(Number(e.target.value))}>
              <option value={0}>None</option><option value={0.2}>Last 20%</option><option value={0.3}>Last 30%</option>
            </select>
          </label>
          <button className={btn} onClick={() => run.mutate()} disabled={run.isPending || !adminToken}>{run.isPending ? "Running…" : "Run"}</button>
          {!adminToken && <span className="text-sm text-amber-300">Enter the admin token on the Connection page to run backtests.</span>}
        </div>
        <div className="mt-3"><ErrorBox error={run.error} /></div>
      </Card>

      {!latest && <Card title="Result"><Empty>No backtest yet.</Empty></Card>}
      {latest && (
        <>
          <Card title={`Result · ${latest.symbol} · ${fmtIst(new Date(latest.createdAt).getTime())}`}>
            {latest.metrics.warnings.map((w) => <p key={w} className="mb-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-sm text-amber-200">{w}</p>)}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
              <Metric k="Trades" v={String(latest.metrics.trades)} />
              <Metric k="Win rate" v={fmtPct(latest.metrics.winRate)} />
              <Metric k="Net profit" v={fmtMoney(latest.metrics.netProfit)} />
              <Metric k="Net return" v={fmtPct(latest.metrics.netReturnPct)} />
              <Metric k="Profit factor" v={latest.metrics.profitFactor == null ? "n/a (no losses)" : fmtNum(latest.metrics.profitFactor)} />
              <Metric k="Max drawdown" v={`${fmtMoney(latest.metrics.maxDrawdown)} (${fmtPct(latest.metrics.maxDrawdownPct)})`} />
              <Metric k="Expectancy (R)" v={fmtNum(latest.metrics.expectancyR, 3)} />
              <Metric k="Reward:risk" v={fmtNum(latest.metrics.rewardToRisk)} />
            </dl>
            <p className="mt-3 text-xs text-slate-500">Bars {latest.bars} · Signals {latest.signals} · Skipped entries {latest.skipped}. Fills at next open with 5 bps slippage. Not a forecast.</p>
          </Card>
          {latest.walkForward && (
            <Card title={`Walk-forward · last ${Math.round(latest.walkForward.oosFraction * 100)}% out-of-sample`}>
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Segment</th><th>Bars</th><th>Trades</th><th>Win rate</th><th>Net profit</th><th>Max DD</th></tr></thead>
                <tbody>
                  {(["inSample", "outOfSample"] as const).map((seg) => {
                    const d = latest.walkForward![seg];
                    return (
                      <tr key={seg} className="border-t border-slate-800">
                        <td className="py-1.5">{seg === "inSample" ? "In-sample" : "Out-of-sample"}</td><td>{d.bars}</td><td>{d.metrics.trades}</td>
                        <td>{fmtPct(d.metrics.winRate)}</td><td>{fmtMoney(d.metrics.netProfit)}</td><td>{fmtPct(d.metrics.maxDrawdownPct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">{latest.walkForward.note}</p>
            </Card>
          )}
          <Card title="Trades (latest 100)">
            {latest.trades.length === 0 ? <Empty>No closed trades.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Exit</th><th>Qty</th><th>Entry</th><th>Exit price</th><th>Reason</th><th>Net P&amp;L</th><th>R</th></tr></thead>
                  <tbody>
                    {latest.trades.map((t, i) => (
                      <tr key={i} className="border-t border-slate-800">
                        <td className="py-1.5">{fmtIst(t.exitTime)}</td><td>{t.qty}</td><td>{fmtMoney(t.entryPrice)}</td><td>{fmtMoney(t.exitPrice)}</td>
                        <td>{REASON_LABELS[t.exitReason] ?? t.exitReason}</td>
                        <td className={t.netPnl >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtMoney(t.netPnl)}</td><td>{fmtNum(t.rMultiple)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-slate-400">{k}</dt><dd className="font-medium">{v}</dd></div>;
}
