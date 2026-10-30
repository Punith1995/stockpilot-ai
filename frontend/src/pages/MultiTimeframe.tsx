import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtMoney, fmtNum } from "../lib/format";
import type { Instrument, MtfResult } from "../types";
import { Badge } from "../components/Badge";
import { Card, ErrorBox, input } from "../components/Card";

const TONE: Record<string, "green" | "red" | "slate" | "amber"> = { BULLISH: "green", BEARISH: "red", NEUTRAL: "slate", UNKNOWN: "amber", MIXED: "amber" };

export function MultiTimeframe() {
  const [symbol, setSymbol] = useState("INFY");
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const q = useQuery({ queryKey: ["mtf", symbol], queryFn: () => api<MtfResult>(`/mtf/${symbol}`) });
  return (
    <Card title="Multi-timeframe trend · SAMPLE" actions={
      <select className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
        {(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}
      </select>
    }>
      <ErrorBox error={q.error} />
      {q.data && (
        <>
          <p className="mb-3 text-sm">Alignment: <Badge tone={TONE[q.data.alignment] ?? "slate"}>{q.data.alignment}</Badge></p>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Timeframe</th><th>Close</th><th>EMA 20</th><th>EMA 50</th><th>RSI 14</th><th>Bias</th></tr></thead>
            <tbody>
              {q.data.frames.map((f) => (
                <tr key={f.interval} className="border-t border-slate-800">
                  <td className="py-1.5">{f.interval} min</td><td>{fmtMoney(f.close)}</td><td>{fmtNum(f.ema20)}</td><td>{fmtNum(f.ema50)}</td><td>{fmtNum(f.rsi14)}</td>
                  <td><Badge tone={TONE[f.bias] ?? "slate"}>{f.bias}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">{q.data.note}</p>
        </>
      )}
    </Card>
  );
}
