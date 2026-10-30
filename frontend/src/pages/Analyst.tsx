import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Instrument } from "../types";
import { Badge } from "../components/Badge";
import { Card, ErrorBox, input } from "../components/Card";

interface AnalystResult { symbol: string; asOf: string; method: string; summary: string[]; disclaimer: string }

/** Rule-based summary. Deliberately labelled: this is not an AI model. */
export function Analyst() {
  const [symbol, setSymbol] = useState("TCS");
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const q = useQuery({ queryKey: ["analyst", symbol], queryFn: () => api<AnalystResult>(`/analyst/${symbol}`) });
  return (
    <Card title="Market analyst · rule-based · SAMPLE" actions={
      <div className="flex items-center gap-2">
        <Badge tone="amber">Not AI</Badge>
        <select className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
          {(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}
        </select>
      </div>
    }>
      <ErrorBox error={q.error} />
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {q.data && (
        <>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-200">
            {q.data.summary.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
          <p className="mt-4 rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-400">{q.data.disclaimer}</p>
        </>
      )}
    </Card>
  );
}
