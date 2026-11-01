import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst, fmtMoney } from "../lib/format";
import type { Instrument } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, Empty, ErrorBox, input } from "../components/Card";
import { useDataSource } from "../lib/source";

interface Card_ { title: string; value: string; detail: string }
interface Analysis {
  symbol: string; asOf: string; price: number; levels: { support: number; resistance: number };
  cards: Card_[]; scenarios: { title: string; text: string }[]; risks: string[];
  questions: { q: string; a: string }[]; disclaimer: string;
}
interface Saved { id: string; savedAt: string; result: Analysis }
interface Answer { source: "rule-based" | "language model"; answer: string; question: string }

/** Rule-based analysis. Labelled "Not AI". Suggested questions show fixed, rule-based answers; free text is not supported. */
export function Analyst() {
  const src = useDataSource();
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const [symbol, setSymbol] = useState("TCS");
  const [shown, setShown] = useState<Analysis | null>(null);
  const [openQ, setOpenQ] = useState<number | null>(null);
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const saved = useQuery({ queryKey: ["analyst-saved"], queryFn: () => api<{ items: Saved[] }>("/analyst/saved/list") });
  const run = useMutation({
    mutationFn: () => api<Analysis>(`/analyst/${symbol}`),
    onSuccess: (r) => { setShown(r); setOpenQ(null); },
  });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const ask = useMutation({
    mutationFn: (q: string) => api<Answer>("/analyst/ask", { method: "POST", adminToken, body: { symbol: shown?.symbol ?? symbol, question: q } }),
    onSuccess: (r) => setAnswer(r),
  });
  const save = useMutation({
    mutationFn: () => api<Saved>("/analyst/saved", { method: "POST", adminToken, body: { symbol } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analyst-saved"] }),
  });

  return (
    <div className="grid gap-4">
      <Card title="AI market analyst" actions={<Badge tone="amber">Rule-based, not AI</Badge>}>
        <p className="mb-3 text-sm text-slate-400">Pick a stock to see its trend, momentum, volatility and volume, with bullish and bearish cases and risk warnings. It answers only the suggested questions; it does not take free text.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Stock<br />
            <select className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Stock">
              {(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}
            </select>
          </label>
          <button className={btn} onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? "Analyzing…" : "Analyze"}</button>
          {shown && <button className={btn} onClick={() => save.mutate()} disabled={!adminToken || save.isPending}>Save this analysis</button>}
        </div>
        {!adminToken && shown && <p className="mt-2 text-xs text-amber-300">Enter the admin token on the Connection page to save analyses.</p>}
        <div className="mt-2"><ErrorBox error={run.error ?? instruments.error ?? save.error} /></div>
      </Card>

      {shown && (
        <>
          <Card title={`${shown.symbol} · ${fmtMoney(shown.price)} · ${src.word}`} actions={<span className="text-xs text-slate-500">as of {fmtIst(new Date(shown.asOf).getTime())}</span>}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              {shown.cards.map((c) => (
                <div key={c.title} className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
                  <div className="text-xs uppercase text-slate-500">{c.title}</div>
                  <div className="mt-1 font-semibold text-slate-100">{c.value}</div>
                  <div className="mt-1 text-xs text-slate-400">{c.detail}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-slate-300">Support (20-bar low) {fmtMoney(shown.levels.support)} · Resistance (20-bar high) {fmtMoney(shown.levels.resistance)}</p>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Scenarios">
              <div className="space-y-3 text-sm">
                {shown.scenarios.map((s) => (
                  <div key={s.title} className="rounded border border-slate-800 p-3">
                    <div className={`font-medium ${s.title.startsWith("Bull") ? "text-emerald-300" : "text-red-300"}`}>{s.title}</div>
                    <p className="mt-1 text-slate-300">{s.text}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Risk warnings">
              <ul className="list-disc space-y-2 pl-5 text-sm text-amber-100">{shown.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </Card>
          </div>

          <Card title="Ask about this analysis">
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (question.trim() && adminToken) ask.mutate(question.trim()); }}>
              <input className={`${input} min-w-0 flex-1`} maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="For example: what would invalidate the uptrend?" aria-label="Question" />
              <button className={btn} type="submit" disabled={!adminToken || !question.trim() || ask.isPending}>{ask.isPending ? "Thinking…" : "Ask"}</button>
            </form>
            {!adminToken && <p className="mt-2 text-xs text-amber-300">Enter the admin token on the Connection page to ask questions.</p>}
            <ErrorBox error={ask.error} />
            {answer && (
              <div className="mt-3 rounded border border-slate-800 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-500"><span>{answer.question}</span><Badge tone={answer.source === "language model" ? "green" : "slate"}>{answer.source === "language model" ? "Language model" : "Rule-based"}</Badge></div>
                <p className="text-slate-200">{answer.answer}</p>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">Answers use only this analysis. Free text is matched to topics unless a language model key is configured on the server.</p>
          </Card>
          <Card title="Suggested questions">
            <div className="space-y-2">
              {shown.questions.map((q, i) => (
                <div key={q.q} className="rounded border border-slate-800">
                  <button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-900" onClick={() => setOpenQ(openQ === i ? null : i)} aria-expanded={openQ === i}>{q.q}</button>
                  {openQ === i && <p className="border-t border-slate-800 px-3 py-2 text-sm text-slate-300">{q.a}</p>}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">{shown.disclaimer}</p>
          </Card>
        </>
      )}

      <Card title="Saved analyses">
        <ErrorBox error={saved.error} />
        {saved.data && !saved.data.items.length && <Empty>No saved analyses yet. Analyze a stock and press Save this analysis.</Empty>}
        {saved.data && saved.data.items.length > 0 && (
          <ul className="space-y-2 text-sm">
            {saved.data.items.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2 rounded border border-slate-800 p-2">
                <span>{s.result.symbol} · {fmtMoney(s.result.price)} · {s.result.cards[4]?.value ?? ""}</span>
                <span className="text-xs text-slate-500">saved {fmtIst(new Date(s.savedAt).getTime())}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
