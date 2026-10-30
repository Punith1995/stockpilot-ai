import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtMoney, fmtNum } from "../lib/format";
import type { IndicatorSnapshot, Instrument } from "../types";
import { Card, Empty, ErrorBox, input } from "../components/Card";

const LABELS: Record<string, string> = {
  ema20: "EMA 20", ema50: "EMA 50", ema200: "EMA 200", sma50: "SMA 50", rsi14: "RSI 14", macd: "MACD", macdSignal: "MACD signal",
  adx14: "ADX 14", atr14: "ATR 14", vwap: "VWAP", bollingerUpper: "Bollinger upper", bollingerLower: "Bollinger lower",
};

export function TechnicalAnalysis() {
  const [symbol, setSymbol] = useState("RELIANCE");
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const q = useQuery({ queryKey: ["indicators", symbol], queryFn: () => api<IndicatorSnapshot>(`/indicators/${symbol}`) });
  return (
    <Card title="Technical analysis · latest values · SAMPLE" actions={
      <select className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
        {(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}
      </select>
    }>
      <ErrorBox error={q.error} />
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {q.data && (
        <>
          <p className="mb-3 text-sm text-slate-300">Last close {fmtMoney(q.data.close)} · as of {new Date(q.data.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(q.data.values).map(([k, v]) => (
                <tr key={k} className="border-t border-slate-800"><td className="py-1.5 text-slate-400">{LABELS[k] ?? k}</td><td className="text-right">{v == null ? <span className="text-slate-500">not enough history</span> : fmtNum(v)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">{q.data.note}</p>
        </>
      )}
      {!q.data && !q.error && !q.isLoading && <Empty>Pick a symbol.</Empty>}
    </Card>
  );
}
