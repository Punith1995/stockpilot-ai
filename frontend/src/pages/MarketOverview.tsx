import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtNum, fmtPct } from "../lib/format";
import type { QuoteRow, QuotesResponse } from "../types";
import { Card, Empty, ErrorBox } from "../components/Card";
import { Pager, usePager } from "../components/Pager";
import { IndexChart } from "../components/IndexChart";
import { useDataSource } from "../lib/source";

const INDEX_NAMES = ["NIFTY 50", "NIFTY BANK", "SENSEX", "NIFTY MIDCAP 100"] as const;
const INDEX_TIMEFRAMES = [["1", "1 min"], ["5", "5 min"], ["15", "15 min"], ["60", "1 hour"], ["D", "Daily"]] as const;

const TABS = ["Indices", "Stocks", "Sectors"] as const;

export function MarketOverview() {
  const src = useDataSource();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Indices");
  const q = useQuery({ queryKey: ["quotes"], queryFn: () => api<QuotesResponse>("/market/quotes"), refetchInterval: 15_000 });
  const d = q.data;
  const b = d?.breadth ?? { advancing: 0, declining: 0, unchanged: 0 };
  const total = Math.max(1, b.advancing + b.declining + b.unchanged);

  const [indexInterval, setIndexInterval] = useState<string>("5");
  const pg = usePager(d?.stocks ?? []);
  return (
    <div className="grid gap-4">
      <ErrorBox error={q.error} />
      <div role="tablist" className="flex gap-1">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>{t}</button>
        ))}
      </div>

      {tab === "Indices" && (
        <>
          <Card title={`Index charts · ${src.word} data`} actions={
            <label className="flex items-center gap-2 text-sm">Timeframe
              <select className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm" value={indexInterval} onChange={(e) => setIndexInterval(e.target.value)}>
                {INDEX_TIMEFRAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          }>
            <div className="grid gap-4 xl:grid-cols-2">
              {INDEX_NAMES.map((n) => (
                <div key={n}>
                  <div className="mb-1 text-sm font-medium text-slate-300">{n}</div>
                  <IndexChart name={n} interval={indexInterval} />
                </div>
              ))}
            </div>
          </Card>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {(d?.indices ?? []).map((i: QuoteRow) => (
              <Card key={i.symbol}>
                <div className="text-xs text-slate-400">{i.symbol}</div>
                <div className="mt-1 text-2xl font-semibold">{fmtNum(i.last)}</div>
                <div className={i.changePct >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtNum(i.change)} ({fmtPct(i.changePct)})</div>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="Market status">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-emerald-400">Advancing</span><span>{b.advancing}</span></div>
                <div className="flex justify-between"><span className="text-red-400">Declining</span><span>{b.declining}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Unchanged</span><span>{b.unchanged}</span></div>
                <div className="mt-2 flex h-2 overflow-hidden rounded bg-slate-800">
                  <div className="bg-emerald-500" style={{ width: `${(b.advancing / total) * 100}%` }} />
                  <div className="bg-red-500" style={{ width: `${(b.declining / total) * 100}%` }} />
                </div>
              </div>
            </Card>
          </div>
        </>
      )}

      {tab === "Stocks" && (
        <Card title="Stocks">
          {!d?.stocks.length ? <Empty>No stock data.</Empty> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Last</th><th>Change</th><th>Change %</th></tr></thead>
              <tbody>
                {pg.slice.map((s) => (
                  <tr key={s.symbol} className="border-t border-slate-800">
                    <td className="py-1.5 font-medium">{s.symbol}</td><td>{fmtNum(s.last)}</td>
                    <td className={s.change >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtNum(s.change)}</td>
                    <td className={s.changePct >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtPct(s.changePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {d && d.stocks.length > 0 && <Pager {...pg} />}
        </Card>
      )}

      {tab === "Sectors" && (
        <Card title="Sectors"><Empty>Sector data is not available in this version.</Empty></Card>
      )}
    </div>
  );
}
