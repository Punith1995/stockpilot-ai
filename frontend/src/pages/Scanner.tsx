import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtMoney, fmtNum, fmtPct } from "../lib/format";
import type { ScanRow, StrategyInfo } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, Empty, ErrorBox, input } from "../components/Card";
import { Pager, usePager } from "../components/Pager";
import { useDataSource } from "../lib/source";
import { FullScanCard } from "../components/FullScanCard";

const TABS = ["Quick Scan", "Advanced Builder", "Saved Scans"] as const;
const TIMEFRAMES: [string, string][] = [["1", "1 min"], ["3", "3 min"], ["5", "5 min"], ["10", "10 min"], ["15", "15 min"], ["30", "30 min"], ["60", "1 hour"], ["240", "4 hour"]];
type SortKey = "score" | "changePct" | "rsi" | "relVolume";

export function Scanner() {
  const src = useDataSource();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Quick Scan");
  const [interval, setInterval] = useState("5");
  const [rsiMin, setRsiMin] = useState(50);
  const [rsiMax, setRsiMax] = useState(70);
  const [minAdx, setMinAdx] = useState(20);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const strat = useQuery({ queryKey: ["strategies"], queryFn: () => api<StrategyInfo>("/strategies") });
  const bad = rsiMin > rsiMax;
  const run = useMutation({
    mutationFn: () => api<{ results: (ScanRow & Partial<Row>)[]; interval: number }>("/scanner/run", { method: "POST", body: { interval, config: { rsiMin, rsiMax, minAdx } } }),
  });
  type Row = { price: number; changePct: number | null; trend: string | null; emaStatus: string | null; rsi: number | null; macd: number | null; adx: number | null; relVolume: number | null; plan: { entry: number; stop: number; target: number } | null };

  const rows = useMemo(() => {
    const lo = priceMin ? Number(priceMin) : -Infinity, hi = priceMax ? Number(priceMax) : Infinity;
    const q = search.trim().toUpperCase();
    const list = (run.data?.results ?? []).filter((r) => {
      const p = r.price ?? null;
      return (p == null || (p >= lo && p <= hi)) && (!q || r.symbol.includes(q));
    });
    const key = (r: ScanRow & Partial<Row>): number => {
      if (sortKey === "score") return r.passedChecks / Math.max(1, r.totalChecks);
      if (sortKey === "changePct") return r.changePct ?? -Infinity;
      if (sortKey === "rsi") return r.rsi ?? -Infinity;
      return r.relVolume ?? -Infinity;
    };
    return [...list].sort((a, b) => key(b) - key(a));
  }, [run.data, priceMin, priceMax, search, sortKey]);

  const pg = usePager(rows);
  return (
    <div className="space-y-4">
    <FullScanCard />
    <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Card title="Scan filters" actions={<span className="text-xs text-slate-500">{strat.data?.name ?? ""}</span>}>
        <div className="space-y-3 text-sm">
          <label className="block">Universe
            <select className={`${input} mt-1 w-full`} disabled><option>{src.live ? "All NSE equities (live)" : "Sample list (5 stocks)"}</option></select>
          </label>
          <label className="block">Timeframe
            <select className={`${input} mt-1 w-full`} value={interval} onChange={(e) => setInterval(e.target.value)} aria-label="Timeframe">
              {TIMEFRAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block">Direction
            <select className={`${input} mt-1 w-full`} defaultValue="bullish" aria-label="Direction">
              <option value="bullish">Bullish (BUY rules)</option>
              <option value="bearish" disabled>Bearish (not in this version)</option>
            </select>
          </label>
          <label className="block">Strategy
            <select className={`${input} mt-1 w-full`} disabled><option>EMA Momentum Pro</option></select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>Price min<input className={`${input} mt-1 w-full`} type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} /></label>
            <label>Price max<input className={`${input} mt-1 w-full`} type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} /></label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label>RSI min<input className={`${input} mt-1 w-full`} type="number" value={rsiMin} onChange={(e) => setRsiMin(Number(e.target.value))} /></label>
            <label>RSI max<input className={`${input} mt-1 w-full`} type="number" value={rsiMax} onChange={(e) => setRsiMax(Number(e.target.value))} /></label>
          </div>
          <label className="block">Min ADX<input className={`${input} mt-1 w-full`} type="number" value={minAdx} onChange={(e) => setMinAdx(Number(e.target.value))} /></label>
          {bad && <p className="text-red-300">RSI min must not exceed RSI max.</p>}
          <button className={`${btn} w-full`} onClick={() => run.mutate()} disabled={bad || run.isPending}>{run.isPending ? "Scanning…" : "Run scan"}</button>
          <p className="text-xs text-slate-500">Universe and strategy are fixed in this version. RSI range and ADX are applied to the strategy checks; price filters apply to the last price shown.</p>
        </div>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <div role="tablist" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>{t}</button>
          ))}
        </div>
        {tab === "Advanced Builder" && <Card><p className="text-sm">Open the full builder: <Link to="/builder" className="text-sky-400 underline">Scanner Builder</Link></p></Card>}
        {tab === "Saved Scans" && <Card><p className="text-sm">Saved presets live in the <Link to="/library" className="text-sky-400 underline">Strategy Library</Link>.</p></Card>}

        {tab === "Quick Scan" && (
          <Card title={run.data ? `Results · ${rows.length} of ${run.data.results.length} stocks · ${TIMEFRAMES.find(([v]) => v === interval)?.[1]}` : "Results"} actions={
            run.data ? (
              <div className="flex flex-wrap gap-2">
                <input className={`${input} w-28`} placeholder="Search symbol" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search symbol" />
                <select className={input} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort by">
                  <option value="score">Sort: signal score</option><option value="changePct">Sort: change %</option><option value="rsi">Sort: RSI</option><option value="relVolume">Sort: relative volume</option>
                </select>
              </div>
            ) : undefined
          }>
            <ErrorBox error={run.error} />
            {!run.data && !run.isPending && <Empty>Set filters and run the scan.</Empty>}
            {run.data && !rows.length && <Empty>No stocks match the search or price filter.</Empty>}
            {run.data && rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[60rem] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500"><tr>
                    <th className="py-2">Symbol</th><th>Price</th><th>Change %</th><th>Trend</th><th>EMA status</th><th>RSI</th><th>MACD</th><th>ADX</th><th>Rel. vol</th><th>Signal</th><th>Score</th><th>Entry</th><th>Stop</th><th>Target</th><th></th>
                  </tr></thead>
                  <tbody>
                    {pg.slice.map((r) => {
                      const x = r as ScanRow & Row;
                      return (
                        <tr key={r.symbol} className="border-t border-slate-800">
                          <td className="py-1.5 font-medium">{r.symbol}</td>
                          <td>{x.price == null ? "—" : fmtNum(x.price)}</td>
                          <td className={x.changePct == null ? "" : x.changePct >= 0 ? "text-emerald-400" : "text-red-400"}>{x.changePct == null ? "—" : fmtPct(x.changePct)}</td>
                          <td className={x.trend === "Bullish" ? "text-emerald-300" : x.trend === "Bearish" ? "text-red-300" : ""}>{x.trend ?? "—"}</td>
                          <td className="text-xs text-slate-300">{x.emaStatus ?? "—"}</td>
                          <td>{x.rsi == null ? "—" : fmtNum(x.rsi, 1)}</td>
                          <td className={x.macd == null ? "" : x.macd >= 0 ? "text-emerald-300" : "text-red-300"}>{x.macd == null ? "—" : fmtNum(x.macd, 2)}</td>
                          <td>{x.adx == null ? "—" : fmtNum(x.adx, 1)}</td>
                          <td>{x.relVolume == null ? "—" : fmtNum(x.relVolume, 2)}</td>
                          <td><Badge tone={r.signal === "BUY" ? "green" : "slate"}>{r.signal}</Badge></td>
                          <td>{Math.round((r.passedChecks / Math.max(1, r.totalChecks)) * 100)}</td>
                          <td>{x.plan ? fmtMoney(x.plan.entry) : "—"}</td>
                          <td>{x.plan ? fmtMoney(x.plan.stop) : "—"}</td>
                          <td>{x.plan ? fmtMoney(x.plan.target) : "—"}</td>
                          <td><Link to={`/chart?symbol=${r.symbol}`} className="rounded bg-sky-700 px-2 py-1 text-xs text-white">View chart</Link></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Pager {...pg} />
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">{src.word} data. Entry, stop and target appear only when the last bar is a BUY. Not a recommendation.</p>
          </Card>
        )}
      </div>
    </div>
    </div>
  );
}
