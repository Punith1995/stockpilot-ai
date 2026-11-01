import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtMoney, fmtPct } from "../lib/format";
import type { PaperSnapshot, QuotesResponse, RiskView } from "../types";
import { EquityChart } from "../components/EquityChart";
import { Card, Empty, ErrorBox, Tile } from "../components/Card";
import { useDataSource } from "../lib/source";

const TABS = ["Overview", "Risk metrics"] as const;
const pnlTone = (n: number) => (n >= 0 ? "text-emerald-400" : "text-red-400");

/** Portfolio and risk for paper trading only. Sector labels come from the sample instrument list. */
export function Portfolio() {
  const src = useDataSource();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const paper = useQuery({ queryKey: ["paper"], queryFn: () => api<PaperSnapshot>("/paper"), refetchInterval: 10_000 });
  const risk = useQuery({ queryKey: ["risk"], queryFn: () => api<RiskView>("/risk/limits"), refetchInterval: 15_000 });
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: () => api<QuotesResponse>("/market/quotes"), refetchInterval: 30_000 });
  const p = paper.data;
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: { symbol: string; sector?: string }[] }>("/instruments") });
  const sectorOf = Object.fromEntries((instruments.data?.items ?? []).map((i) => [i.symbol, i.sector ?? "Unclassified"]));
  const last = new Map((quotes.data?.stocks ?? []).map((q) => [q.symbol, q.last]));

  const positions = (p?.positions ?? []).map((x) => {
    const mark = last.get(x.symbol) ?? x.entry;
    return { ...x, mark, cost: x.qty * x.entry, value: x.qty * mark, unrealized: x.qty * (mark - x.entry), riskAmt: Math.max(0, (x.entry - x.stop) * x.qty) };
  });
  const invested = positions.reduce((s, x) => s + x.cost, 0);
  const marketValue = positions.reduce((s, x) => s + x.value, 0);
  const unrealized = positions.reduce((s, x) => s + x.unrealized, 0);
  const cap = p?.startCapital ?? 0;
  const cash = p?.cash ?? 0;
  const totalEquity = cash + marketValue;
  const totalRisk = positions.reduce((s, x) => s + x.riskAmt, 0);
  const equityCurve = p && p.trades.length
    ? p.trades.reduce<{ time: number; equity: number }[]>((acc, t) => {
        const prev = acc.at(-1)?.equity ?? cap;
        return [...acc, { time: t.exitTime, equity: Math.round((prev + t.netPnl) * 100) / 100 }];
      }, [])
    : [];

  return (
    <div className="grid gap-4">
      <ErrorBox error={paper.error ?? risk.error ?? quotes.error} />
      <div role="tablist" className="flex gap-1">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>{t}</button>
        ))}
      </div>

      {tab === "Overview" && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="Total capital" value={fmtMoney(p ? cap : null)} />
            <Tile label="Available cash" value={fmtMoney(p ? cash : null)} />
            <Tile label="Invested (at cost)" value={fmtMoney(p ? invested : null)} />
            <Tile label="Realized P&L" value={fmtMoney(p?.realizedPnl ?? null)} tone={pnlTone(p?.realizedPnl ?? 0)} />
            <Tile label="Unrealized P&L" value={fmtMoney(p ? unrealized : null)} tone={pnlTone(unrealized)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card title="Equity from closed paper trades">
              {equityCurve.length ? <EquityChart equity={equityCurve} /> : <Empty>No closed paper trades yet. The curve appears after the first exit.</Empty>}
            </Card>
            <Card title="Allocation">
              {!positions.length ? <Empty>No open positions.</Empty> : (
                <ul className="space-y-2 text-sm">
                  {positions.map((x) => {
                    const pct = invested ? (x.cost / invested) * 100 : 0;
                    return (
                      <li key={x.symbol}>
                        <div className="flex justify-between"><span>{x.symbol}</span><span className="text-slate-400">{fmtPct(pct)}</span></div>
                        <div className="h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-sky-600" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <h3 className="mt-4 text-xs uppercase text-slate-500">Sector exposure (at cost)</h3>
              {!positions.length ? <Empty>No open positions.</Empty> : (
                <ul className="mt-2 space-y-2 text-sm">
                  {Object.entries(positions.reduce<Record<string, number>>((acc, x) => { const sec = sectorOf[x.symbol] ?? "Unclassified"; acc[sec] = (acc[sec] ?? 0) + x.cost; return acc; }, {})).sort((a, b) => b[1] - a[1]).map(([sec, cost]) => {
                    const pct = invested ? (cost / invested) * 100 : 0;
                    return (
                      <li key={sec}>
                        <div className="flex justify-between"><span>{sec}</span><span className="text-slate-400">{fmtPct(pct)} · {fmtMoney(cost)}</span></div>
                        <div className="h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-violet-600" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 text-xs text-slate-500">Equity now: {fmtMoney(p ? totalEquity : null)}. Sector labels are fixed per sample stock and are not live data.</p>
            </Card>
          </div>

          <Card title="Positions">
            {!positions.length ? <Empty>No open positions.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr><th className="py-2">Symbol</th><th>Qty</th><th>Entry</th><th>Last</th><th>Stop</th><th>Target</th><th>Unrealized</th><th>Risk amount</th></tr>
                  </thead>
                  <tbody>
                    {positions.map((x) => (
                      <tr key={x.symbol} className="border-t border-slate-800">
                        <td className="py-1.5">{x.symbol}</td><td>{x.qty}</td><td>{fmtMoney(x.entry)}</td><td>{fmtMoney(x.mark)}</td>
                        <td>{fmtMoney(x.stop)}</td><td>{fmtMoney(x.target)}</td>
                        <td className={pnlTone(x.unrealized)}>{fmtMoney(x.unrealized)}</td><td>{fmtMoney(x.riskAmt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">Last price is {src.word} data. Fallback to entry if a symbol has no quote.</p>
          </Card>

          <Card title="Closed paper trades">
            {!p?.trades.length ? <Empty>No closed trades yet.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Reason</th><th>Net P&amp;L</th></tr></thead>
                  <tbody>
                    {p.trades.map((t) => (
                      <tr key={`${t.symbol}-${t.exitTime}`} className="border-t border-slate-800">
                        <td className="py-1.5">{t.symbol}</td><td>{t.qty}</td><td>{fmtMoney(t.entry)}</td><td>{fmtMoney(t.exit)}</td><td>{t.reason}</td>
                        <td className={pnlTone(t.netPnl)}>{fmtMoney(t.netPnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === "Risk metrics" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Exposure">
            <div className="mb-2 flex h-3 overflow-hidden rounded bg-slate-800">
              <div className="bg-sky-600" style={{ width: `${Math.min(100, cap ? (invested / cap) * 100 : 0)}%` }} />
            </div>
            <p className="text-sm">Invested at cost: {fmtMoney(invested)} ({fmtPct(cap ? (invested / cap) * 100 : null)} of capital)</p>
            <p className="mt-2 text-sm">Open risk if all stops hit: {fmtMoney(totalRisk)} ({fmtPct(cap ? (totalRisk / cap) * 100 : null)} of capital)</p>
          </Card>
          <Card title="Risk by strategy">
            {!positions.length ? <Empty>No open positions.</Empty> : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 text-left">Strategy</th><th className="text-right">Positions</th><th className="text-right">Open risk</th></tr></thead>
                <tbody>
                  <tr className="border-t border-slate-800"><td className="py-1.5">EMA Momentum Pro</td><td className="text-right">{positions.length}</td><td className="text-right">{fmtMoney(totalRisk)}</td></tr>
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-slate-500">Paper positions are opened only by EMA Momentum Pro in this version.</p>
          </Card>
          <Card title="Risk settings">
            {risk.data && (
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-t border-slate-800"><td className="py-1.5 text-slate-400">Max open positions</td><td className="text-right">{risk.data.current.openPositions} / {risk.data.limits.maxOpenPositions}</td></tr>
                  <tr className="border-t border-slate-800"><td className="py-1.5 text-slate-400">Daily loss limit</td><td className="text-right">{risk.data.limits.maxDailyLossPct}% of capital</td></tr>
                  <tr className="border-t border-slate-800"><td className="py-1.5 text-slate-400">Today's realized P&amp;L</td><td className="text-right">{fmtMoney(risk.data.current.dailyRealizedPnl)}</td></tr>
                  <tr className="border-t border-slate-800"><td className="py-1.5 text-slate-400">Max trades per day</td><td className="text-right">{risk.data.limits.maxTradesPerDay}</td></tr>
                  <tr className="border-t border-slate-800"><td className="py-1.5 text-slate-400">Max exposure per stock</td><td className="text-right">{risk.data.limits.maxExposurePerStockPct}%</td></tr>
                  <tr className="border-t border-slate-800"><td className="py-1.5 text-slate-400">Emergency stop</td><td className="text-right">{risk.data.current.emergencyStop ? "ON" : "Off"}</td></tr>
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
