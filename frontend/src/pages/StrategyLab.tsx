import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtMoney, fmtNum } from "../lib/format";
import type { SweepRow } from "../types";
import { btn, Card, ErrorBox, input } from "../components/Card";
import { useDataSource } from "../lib/source";

const parseList = (s: string) => s.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
type SortKey = "oosProfit" | "oosWinRate" | "oosProfitFactor";
const tone = (n: number) => (n >= 0 ? "text-emerald-400" : "text-red-400");

export function StrategyLab() {
  const src = useDataSource();
  const adminToken = useAdmin((s) => s.adminToken);
  const [symbol, setSymbol] = useState("TCS");
  const [targets, setTargets] = useState("1.5, 2");
  const [atrs, setAtrs] = useState("1, 1.5");
  const [sortBy, setSortBy] = useState<SortKey>("oosProfit");
  const [minTrades, setMinTrades] = useState(3);
  const [pick, setPick] = useState<string | null>(null);
  const t = parseList(targets), a = parseList(atrs);
  const combos = t.length * a.length;
  const sweep = useMutation({
    mutationFn: () => api<{ rows: SweepRow[]; warning: string; combinations: number }>("/strategy-lab/sweep", { method: "POST", adminToken, body: { symbol, days: 40, targetR: t, atrMultiple: a, oosFraction: 0.3 } }),
    onSuccess: () => setPick(null),
  });
  const key = (r: SweepRow) => `${r.targetR}|${r.atrMultiple}`;
  const rows = useMemo(() => {
    const list = [...(sweep.data?.rows ?? [])];
    const score = (r: SweepRow) => sortBy === "oosProfit" ? r.outOfSample.netProfit : sortBy === "oosWinRate" ? (r.outOfSample.winRate ?? -1) : (r.outOfSample.profitFactor ?? -1);
    return list.sort((x, y) => score(y) - score(x));
  }, [sweep.data, sortBy]);
  const selected = rows.find((r) => key(r) === pick) ?? rows[0];
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.outOfSample.netProfit)));
  const targetsU = [...new Set(rows.map((r) => r.targetR))].sort((x, y) => x - y);
  const atrsU = [...new Set(rows.map((r) => r.atrMultiple))].sort((x, y) => x - y);
  const cell = (tr: number, at: number) => rows.find((r) => r.targetR === tr && r.atrMultiple === at);

  return (
    <div className="grid gap-4">
      <Card title={`Strategy lab · parameter sweep · ${src.word}`}>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label>Symbol<br /><input className={input} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></label>
          <label>Target R values<br /><input className={input} value={targets} onChange={(e) => setTargets(e.target.value)} /></label>
          <label>ATR multiples<br /><input className={input} value={atrs} onChange={(e) => setAtrs(e.target.value)} /></label>
          <label>Rank by<br /><select className={input} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}><option value="oosProfit">Out-of-sample net profit</option><option value="oosWinRate">Out-of-sample win rate</option><option value="oosProfitFactor">Out-of-sample profit factor</option></select></label>
          <label>Min OOS trades<br /><input className={`${input} w-24`} type="number" min={0} value={minTrades} onChange={(e) => setMinTrades(Number(e.target.value))} /></label>
          <button className={btn} onClick={() => sweep.mutate()} disabled={!adminToken || combos < 1 || combos > 9 || sweep.isPending}>{sweep.isPending ? "Running…" : `Run ${combos} combinations`}</button>
        </div>
        {combos > 9 && <p className="mt-2 text-sm text-red-300">At most 9 combinations.</p>}
        {!adminToken && <p className="mt-2 text-sm text-amber-300">Enter the admin token on the Connection page to run a sweep.</p>}
        <div className="mt-2"><ErrorBox error={sweep.error} /></div>
        <p className="mt-3 text-xs text-slate-500">Each combination runs on the earlier 70% of sessions (in-sample) and the last 30% (out-of-sample). Combinations with fewer out-of-sample trades than the minimum are flagged as low sample.</p>
      </Card>

      {sweep.data && (
        <>
          <p className="rounded border border-amber-800 bg-amber-950/40 p-2 text-sm text-amber-200">{sweep.data.warning}</p>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Heatmap · out-of-sample net profit">
              <table className="w-full text-center text-sm">
                <thead><tr><th className="py-1 text-xs text-slate-500">Target R ↓ / ATR × →</th>{atrsU.map((at) => <th key={at} className="text-xs text-slate-400">{at}</th>)}</tr></thead>
                <tbody>{targetsU.map((tr) => (
                  <tr key={tr}><th className="py-1 text-xs text-slate-400">{tr}</th>{atrsU.map((at) => {
                    const c = cell(tr, at);
                    if (!c) return <td key={at} className="text-slate-600">—</td>;
                    const intensity = Math.min(0.85, Math.abs(c.outOfSample.netProfit) / maxAbs);
                    const bg = c.outOfSample.netProfit >= 0 ? `rgba(16,185,129,${intensity})` : `rgba(239,68,68,${intensity})`;
                    return <td key={at} className="cursor-pointer py-2" style={{ background: bg }} onClick={() => setPick(key(c))} title="Show details">{fmtMoney(c.outOfSample.netProfit)}</td>;
                  })}</tr>
                ))}</tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">Click a cell to inspect that combination.</p>
            </Card>

            <Card title="Win rate and equity · out-of-sample">
              <div className="space-y-2 text-sm">
                {rows.map((r) => (
                  <div key={key(r)} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-slate-400">R {r.targetR} · ATR {r.atrMultiple}</span>
                    <div className="h-3 flex-1 rounded bg-slate-800"><div className="h-3 rounded bg-sky-500" style={{ width: `${Math.min(100, r.outOfSample.winRate ?? 0)}%` }} /></div>
                    <span className="w-16 shrink-0 text-right">{r.outOfSample.winRate == null ? "n/a" : `${fmtNum(r.outOfSample.winRate, 1)}%`}</span>
                  </div>
                ))}
              </div>
              {selected?.outOfSample.equity && selected.outOfSample.equity.length > 1 && <EquityLine points={selected.outOfSample.equity.map((p) => p.equity)} />}
              <p className="mt-1 text-xs text-slate-500">Equity after each closed out-of-sample trade, for R {selected?.targetR} · ATR {selected?.atrMultiple}. It moves only when a trade closes.</p>
            </Card>
          </div>

          <Card title="Results ranked">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Target R</th><th>ATR ×</th><th>In-sample P&amp;L</th><th>OOS trades</th><th>OOS win rate</th><th>OOS P&amp;L</th><th>OOS profit factor</th><th>OOS max DD</th><th>Sample</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={key(r)} className={`border-t border-slate-800 ${key(r) === key(selected!) ? "bg-slate-900" : ""}`} onClick={() => setPick(key(r))}>
                    <td className="py-1.5">{r.targetR}</td><td>{r.atrMultiple}</td>
                    <td className={tone(r.inSample.netProfit)}>{fmtMoney(r.inSample.netProfit)}</td>
                    <td>{r.outOfSample.trades}</td><td>{r.outOfSample.winRate == null ? "n/a" : `${fmtNum(r.outOfSample.winRate, 1)}%`}</td>
                    <td className={tone(r.outOfSample.netProfit)}>{fmtMoney(r.outOfSample.netProfit)}</td>
                    <td>{r.outOfSample.profitFactor == null ? "n/a" : fmtNum(r.outOfSample.profitFactor)}</td><td>{fmtNum(r.outOfSample.maxDrawdownPct)}%</td>
                    <td>{r.outOfSample.trades < minTrades ? <span className="rounded bg-amber-900/50 px-2 py-0.5 text-xs text-amber-200">Low sample</span> : <span className="text-xs text-slate-500">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Walk-forward · in-sample vs out-of-sample">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Combination</th><th>In-sample</th><th>Out-of-sample</th><th>Holds up?</th></tr></thead>
                <tbody>{rows.map((r) => {
                  const holds = r.inSample.netProfit > 0 && r.outOfSample.netProfit > 0;
                  return <tr key={key(r)} className="border-t border-slate-800"><td className="py-1.5">R {r.targetR} · ATR {r.atrMultiple}</td><td className={tone(r.inSample.netProfit)}>{fmtMoney(r.inSample.netProfit)}</td><td className={tone(r.outOfSample.netProfit)}>{fmtMoney(r.outOfSample.netProfit)}</td><td>{holds ? "Yes, both periods positive" : "No"}</td></tr>;
                })}</tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">A single split is a weak test. Use walk-forward on the Backtesting page for rolling windows.</p>
            </Card>

            <Card title={`Monthly P&L · R ${selected?.targetR ?? "—"} · ATR ${selected?.atrMultiple ?? "—"}`}>
              {selected?.outOfSample.monthly?.length ? (
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Month</th><th>Net P&amp;L</th></tr></thead>
                  <tbody>{selected.outOfSample.monthly.map((m) => <tr key={m.month} className="border-t border-slate-800"><td className="py-1.5">{m.month}</td><td className={tone(m.netPnl)}>{fmtMoney(m.netPnl)}</td></tr>)}</tbody>
                </table>
              ) : <p className="text-sm text-slate-500">No closed out-of-sample trades for this combination.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function EquityLine({ points }: { points: number[] }) {
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const w = 600, h = 120;
  const d = points.map((v, i) => `${(i / (points.length - 1)) * w},${h - ((v - min) / span) * h}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-32 w-full" role="img" aria-label="Equity curve"><polyline fill="none" stroke="#38bdf8" strokeWidth="2" points={d} /></svg>;
}
