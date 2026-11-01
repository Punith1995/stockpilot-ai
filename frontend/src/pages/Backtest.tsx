import { Link } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst, fmtMoney, fmtNum, fmtPct, REASON_LABELS } from "../lib/format";
import type { BacktestResult, Instrument } from "../types";
import { btn, Card, Empty, ErrorBox, input, Tile } from "../components/Card";
import { EquityChart } from "../components/EquityChart";
import { useDataSource } from "../lib/source";

const TIMEFRAMES: [string, string][] = [["1", "1 min"], ["3", "3 min"], ["5", "5 min"], ["10", "10 min"], ["15", "15 min"], ["30", "30 min"], ["60", "1 hour"], ["240", "4 hour"]];

/** Net P&L grouped by IST calendar month of the exit. Based on the stored trades only. */
function monthlyPnl(trades: BacktestResult["trades"]): { month: string; pnl: number }[] {
  const map = new Map<string, number>();
  for (const t of trades) {
    const d = new Date(t.exitTime + 19_800_000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + t.netPnl);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, pnl]) => ({ month, pnl: Math.round(pnl * 100) / 100 }));
}

export function Backtest() {
  const src = useDataSource();
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const [strategyId, setStrategyId] = useState("ema-momentum-pro");
  const [symbol, setSymbol] = useState("TCS");
  const [interval, setInterval] = useState("1");
  const [days, setDays] = useState(40);
  const [capital, setCapital] = useState(100000);
  const [product, setProduct] = useState<"DELIVERY" | "INTRADAY">("DELIVERY");
  const [slippage, setSlippage] = useState(5);
  const [oos, setOos] = useState(0);
  const [folds, setFolds] = useState(0);
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const strategies = useQuery({ queryKey: ["simple"], queryFn: () => api<{ items: { id: string; name: string }[] }>("/strategies/simple") });
  const history = useQuery({ queryKey: ["backtests"], queryFn: () => api<{ items: BacktestResult[] }>("/backtests") });
  const run = useMutation({
    mutationFn: () => api<BacktestResult>("/backtests", { method: "POST", adminToken, body: { strategyId, symbol, interval, days, capital, productType: product, slippageBps: slippage, oosFraction: oos, folds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backtests"] }),
  });
  const latest = run.data ?? history.data?.items.at(-1);
  const tfLabel = TIMEFRAMES.find(([v]) => v === (latest?.interval ?? interval))?.[1] ?? "1 min";
  const wins = latest?.trades.filter((t) => t.netPnl > 0).length ?? 0;
  const losses = latest?.trades.filter((t) => t.netPnl <= 0).length ?? 0;

  return (
    <div className="grid gap-4">
      <Card title={`Backtest setup · ${src.word} data`}>
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4 xl:grid-cols-[minmax(0,2fr)_repeat(7,minmax(0,1fr))]">
          <label>Strategy<select className={`${input} mt-1 w-full`} value={strategyId} onChange={(e) => setStrategyId(e.target.value)} aria-label="Strategy">
            <option value="ema-momentum-pro">EMA Momentum Pro</option>
            {(strategies.data?.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
          <label>Symbol<select className={`${input} mt-1 w-full`} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
            {(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}
          </select></label>
          <label>Timeframe<select className={`${input} mt-1 w-full`} value={interval} onChange={(e) => setInterval(e.target.value)} aria-label="Timeframe">
            {TIMEFRAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
          <label>Sessions<input className={`${input} mt-1 w-full`} type="number" min={5} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Sessions" /></label>
          <label>Initial capital (₹)<input className={`${input} mt-1 w-full`} type="number" min={10000} step={10000} value={capital} onChange={(e) => setCapital(Number(e.target.value))} aria-label="Initial capital" /></label>
          <label>Brokerage model<select className={`${input} mt-1 w-full`} value={product} onChange={(e) => setProduct(e.target.value as "DELIVERY" | "INTRADAY")} aria-label="Brokerage model">
            <option value="DELIVERY">Delivery</option><option value="INTRADAY">Intraday</option>
          </select></label>
          <label>Slippage (bps)<select className={`${input} mt-1 w-full`} value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} aria-label="Slippage">
            <option value={5}>5</option><option value={10}>10</option><option value={20}>20</option>
          </select></label>
          <label>Out-of-sample<select className={`${input} mt-1 w-full`} value={oos} onChange={(e) => setOos(Number(e.target.value))} aria-label="Out-of-sample">
            <option value={0}>None</option><option value={0.2}>Last 20%</option><option value={0.3}>Last 30%</option>
          </select></label>
          <label>Rolling folds<select className={`${input} mt-1 w-full`} value={folds} onChange={(e) => setFolds(Number(e.target.value))} aria-label="Rolling folds">
            <option value={0}>Off</option><option value={2}>2 blocks</option><option value={3}>3 blocks</option><option value={4}>4 blocks</option>
          </select></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className={btn} onClick={() => run.mutate()} disabled={run.isPending || !adminToken}>{run.isPending ? "Running…" : "Run backtest"}</button>
          <Link to="/lab" className="self-center text-sm text-sky-400 underline">Parameter sensitivity (Strategy Lab)</Link>
          {!adminToken && <span className="text-sm text-amber-300">Enter the admin token on the Connection page to run backtests.</span>}
        </div>
        <div className="mt-3"><ErrorBox error={run.error} /></div>
        <p className="mt-3 text-xs text-slate-500">Brokerage and tax figures are estimates from the cost model in the backend. Results are on {src.word} data and are not a forecast.</p>
      </Card>

      {!latest && <Card title="Result"><Empty>No backtest yet.</Empty></Card>}
      {latest && (
        <>
          <Card title={`Result · ${latest.strategyName ?? "EMA Momentum Pro"} · ${latest.symbol} · ${tfLabel} · ${fmtIst(new Date(latest.createdAt).getTime())}`}>
            {latest.metrics.warnings.map((w) => <p key={w} className="mb-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-sm text-amber-200">{w}</p>)}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Tile label="Net profit" value={fmtMoney(latest.metrics.netProfit)} tone={latest.metrics.netProfit >= 0 ? "text-emerald-300" : "text-red-300"} />
              <Tile label="Win rate" value={latest.metrics.winRate == null ? "n/a" : fmtPct(latest.metrics.winRate)} />
              <Tile label="Total trades" value={latest.metrics.trades} />
              <Tile label="Profit factor" value={latest.metrics.profitFactor == null ? "n/a" : fmtNum(latest.metrics.profitFactor)} />
              <Tile label="Max drawdown" value={`${fmtPct(latest.metrics.maxDrawdownPct)}`} tone="text-red-300" />
              <Tile label="Expectancy (R)" value={latest.metrics.expectancyR == null ? "n/a" : fmtNum(latest.metrics.expectancyR, 3)} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
              <div><dt className="text-slate-400">Initial capital</dt><dd>{fmtMoney(latest.capital ?? null)}</dd></div>
              <div><dt className="text-slate-400">Net return</dt><dd>{fmtPct(latest.metrics.netReturnPct)}</dd></div>
              <div><dt className="text-slate-400">Reward:risk</dt><dd>{latest.metrics.rewardToRisk == null ? "n/a" : fmtNum(latest.metrics.rewardToRisk)}</dd></div>
              <div><dt className="text-slate-400">Bars · signals · skipped</dt><dd>{latest.bars} · {latest.signals} · {latest.skipped}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">Fills at next open with {slippage} bps slippage. Not a forecast.</p>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title={`Equity curve and drawdown · ${src.word}`}>
              <EquityChart equity={latest.equity ?? []} />
            </Card>
            <Card title="Winning vs losing trades">
              {!latest.trades.length ? <Empty>No closed trades.</Empty> : (
                <>
                  <div className="mb-2 flex h-4 overflow-hidden rounded bg-slate-800">
                    <div className="bg-emerald-500" style={{ width: `${(wins / latest.trades.length) * 100}%` }} />
                    <div className="bg-red-500" style={{ width: `${(losses / latest.trades.length) * 100}%` }} />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-400">Wins {wins}</span>
                    <span className="text-red-400">Losses {losses}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-slate-400">Average win</dt><dd>{fmtMoney(latest.metrics.averageWin)}</dd>
                    <dt className="text-slate-400">Average loss</dt><dd>{fmtMoney(latest.metrics.averageLoss)}</dd>
                  </dl>
                  <p className="mt-2 text-xs text-slate-500">Trades list shows the latest 100 closed trades.</p>
                </>
              )}
            </Card>
          </div>

          <Card title="Monthly returns (net P&L by exit month)">
            {!latest.trades.length ? <Empty>No closed trades.</Empty> : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Month (IST)</th><th>Net P&amp;L</th></tr></thead>
                <tbody>
                  {monthlyPnl(latest.trades).map((m) => (
                    <tr key={m.month} className="border-t border-slate-800">
                      <td className="py-1.5">{m.month}</td>
                      <td className={m.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtMoney(m.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {latest.rolling && (
            <Card title={`Rolling walk-forward · ${latest.rolling.folds.length} blocks · ${latest.rolling.positiveFolds} profitable`}>
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Block</th><th>Sessions</th><th>From</th><th>To</th><th>Trades</th><th>Win rate</th><th>Net P&amp;L</th></tr></thead>
                <tbody>{latest.rolling.folds.map((f) => (
                  <tr key={f.fold} className="border-t border-slate-800">
                    <td className="py-1.5">{f.fold}</td><td>{f.sessions}</td>
                    <td>{f.from ? fmtIst(new Date(f.from).getTime()) : "—"}</td><td>{f.to ? fmtIst(new Date(f.to).getTime()) : "—"}</td>
                    <td>{f.trades}</td><td>{f.winRate == null ? "n/a" : `${f.winRate}%`}</td><td className={f.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtMoney(f.netProfit)}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">{latest.rolling.note}</p>
            </Card>
          )}
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
                        <td>{d.metrics.winRate == null ? "n/a" : fmtPct(d.metrics.winRate)}</td><td>{fmtMoney(d.metrics.netProfit)}</td><td>{fmtPct(d.metrics.maxDrawdownPct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">{latest.walkForward.note}</p>
            </Card>
          )}

          <Card title="Trade history (latest 100)">
            {latest.trades.length === 0 ? <Empty>No closed trades.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Exit (IST)</th><th>Qty</th><th>Entry</th><th>Exit price</th><th>Holding</th><th>Exit reason</th><th>Net P&amp;L</th><th>R</th></tr></thead>
                  <tbody>
                    {latest.trades.map((t, i) => {
                      const mins = t.barsHeld * Number(latest.interval ?? "1");
                      return (
                        <tr key={i} className="border-t border-slate-800">
                          <td className="py-1.5 whitespace-nowrap">{fmtIst(t.exitTime)}</td><td>{t.qty}</td><td>{fmtMoney(t.entryPrice)}</td><td>{fmtMoney(t.exitPrice)}</td>
                          <td className="whitespace-nowrap">{t.barsHeld} bars · {mins >= 60 ? `${Math.round(mins / 60)} h` : `${mins} min`}</td>
                          <td>{REASON_LABELS[t.exitReason] ?? t.exitReason}</td>
                          <td className={t.netPnl >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtMoney(t.netPnl)}</td><td>{fmtNum(t.rMultiple)}</td>
                        </tr>
                      );
                    })}
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
