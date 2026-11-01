import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtMoney, fmtNum } from "../lib/format";
import type { Instrument, MtfResult } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, Empty, ErrorBox, input, Tile } from "../components/Card";
import { useDataSource } from "../lib/source";

const LABEL: Record<string, string> = { "1": "1 min", "3": "3 min", "5": "5 min", "10": "10 min", "15": "15 min", "30": "30 min", "60": "1 hour", "240": "4 hour", D: "Daily" };
const TONE: Record<string, "green" | "red" | "slate" | "amber"> = { Bullish: "green", Bearish: "red", Sideways: "slate", Mixed: "amber", Unknown: "amber" };
const dash = (v: number | null, d = 2) => (v == null ? "—" : fmtNum(v, d));

/** Multi-timeframe trend. Every value is computed from the candles on the server, nothing is hard-coded. */
export function MultiTimeframe() {
  const src = useDataSource();
  const [symbol, setSymbol] = useState("INFY");
  const [focus, setFocus] = useState("5");
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const q = useQuery({ queryKey: ["mtf", symbol], queryFn: () => api<MtfResult>(`/mtf/${symbol}`), refetchInterval: 60_000 });
  const d = q.data;
  const f = d?.frames.find((x) => x.timeframe === focus);
  const s = d?.summary;

  return (
    <div className="grid gap-4">
      <Card title={`Multi-timeframe analysis · ${src.word} data`} actions={
        <div className="flex flex-wrap items-center gap-2">
          <select className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Stock">
            {(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}
          </select>
          <button className={btn} onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Refreshing…" : "Refresh analysis"}</button>
        </div>
      }>
        <ErrorBox error={q.error} />
        {!d && !q.error && <Empty>Loading analysis…</Empty>}
        {d && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Overall trend score" value={s?.trendScore == null ? "—" : `${s.trendScore > 0 ? "+" : ""}${fmtNum(s.trendScore, 0)}`} tone={(s?.trendScore ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"} />
              <Tile label="Timeframe agreement" value={s?.agreement == null ? "—" : `${fmtNum(s.agreement, 0)}% (${s.majorityTrend})`} />
              <Tile label="Bullish / bearish frames" value={`${s?.bullishFrames ?? 0} / ${s?.bearishFrames ?? 0} of ${s?.totalFrames ?? 0}`} />
              <Tile label="BUY signals" value={`${s?.buySignals ?? 0} of ${s?.totalFrames ?? 0}`} />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr><th className="py-2">Timeframe</th><th>Close</th><th>Trend</th><th>EMA alignment</th><th>RSI 14</th><th>MACD vs signal</th><th>ADX 14</th><th>Rel. volume</th><th>Signal</th></tr>
                </thead>
                <tbody>
                  {d.frames.map((r) => (
                    <tr key={r.timeframe} className={`border-t border-slate-800 ${r.timeframe === focus ? "bg-sky-950/30" : ""}`}>
                      <td className="py-1.5"><button className="text-sky-400 underline" onClick={() => setFocus(r.timeframe)}>{LABEL[r.timeframe]}</button></td>
                      <td>{r.close == null ? "—" : fmtMoney(r.close)}</td>
                      <td><Badge tone={TONE[r.trend] ?? "slate"}>{r.trend}</Badge></td>
                      <td>{r.emaAlignment}</td>
                      <td>{dash(r.rsi14, 1)}</td>
                      <td>{r.macd == null || r.macdSignal == null ? "—" : r.macd > r.macdSignal ? "Above" : "Below"}</td>
                      <td>{dash(r.adx14, 1)}</td>
                      <td>{dash(r.relVolume, 2)}</td>
                      <td><Badge tone={r.signal === "BUY" ? "green" : "slate"}>{r.signal}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">{d.note} Shown as "—" where history is too short.</p>
          </>
        )}
      </Card>

      {d && f && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card title={`Focus: ${LABEL[f.timeframe]}`} actions={
            <select className={input} value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Focus timeframe">
              {d.frames.map((x) => <option key={x.timeframe} value={x.timeframe}>{LABEL[x.timeframe]}</option>)}
            </select>
          }>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-400">EMA 20</dt><dd className="text-right">{dash(f.ema20)}</dd>
              <dt className="text-slate-400">EMA 50</dt><dd className="text-right">{dash(f.ema50)}</dd>
              <dt className="text-slate-400">EMA 200</dt><dd className="text-right">{dash(f.ema200)}</dd>
              <dt className="text-slate-400">Bars available</dt><dd className="text-right">{f.bars}</dd>
            </dl>
          </Card>
          <Card title="Confirmations">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span>EMA alignment</span><Badge tone={TONE[f.emaAlignment.startsWith("Bullish") ? "Bullish" : f.emaAlignment.startsWith("Bearish") ? "Bearish" : "Mixed"] ?? "slate"}>{f.emaAlignment}</Badge></li>
              <li className="flex justify-between"><span>RSI 14 (above 55)</span><span className={(f.rsi14 ?? 0) >= 55 ? "text-emerald-300" : "text-slate-400"}>{dash(f.rsi14, 1)}</span></li>
              <li className="flex justify-between"><span>MACD above signal</span><span className={f.macd != null && f.macdSignal != null && f.macd > f.macdSignal ? "text-emerald-300" : "text-slate-400"}>{f.macd != null && f.macdSignal != null ? (f.macd > f.macdSignal ? "Yes" : "No") : "—"}</span></li>
              <li className="flex justify-between"><span>ADX (above 20)</span><span className={(f.adx14 ?? 0) > 20 ? "text-emerald-300" : "text-slate-400"}>{dash(f.adx14, 1)}</span></li>
            </ul>
          </Card>
          <Card title="Final signal summary">
            <p className="text-sm font-semibold">{s?.finalSignal}</p>
            <p className="mt-2 text-xs text-slate-400">Rule-based summary across timeframes. Not a recommendation. {src.word} data.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
