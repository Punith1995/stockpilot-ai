import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createChart, LineStyle, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { api } from "../lib/api";
import { fmtMoney, fmtNum, fmtPct } from "../lib/format";
import type { IndicatorSnapshot, Instrument, Candle } from "../types";
import { Card, Empty, ErrorBox, input, Tile } from "../components/Card";
import { useDataSource } from "../lib/source";

const TIMEFRAMES: [string, string][] = [["1", "1 min"], ["3", "3 min"], ["5", "5 min"], ["10", "10 min"], ["15", "15 min"], ["30", "30 min"], ["60", "1 hour"], ["240", "4 hour"], ["D", "Daily"]];
const OPTS = {
  layout: { background: { color: "#0d1528" }, textColor: "#94a3b8" },
  grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
  timeScale: { timeVisible: true },
};
const ist = (ms: number) => (Math.floor(ms / 1000) + 19800) as UTCTimestamp;
const tone = (v: string) => (/Bullish|Strong|High/.test(v) ? "text-emerald-300" : /Bearish|Weak|Low/.test(v) ? "text-red-300" : "text-slate-200");

interface ChartPayload { candles: Candle[]; ema20: (number | null)[]; ema50: (number | null)[]; ema200: (number | null)[]; rsi14: (number | null)[]; macd: (number | null)[]; macdSignal: (number | null)[]; volume: number[] }

function Panels({ data }: { data: ChartPayload }) {
  const priceRef = useRef<HTMLDivElement>(null), volRef = useRef<HTMLDivElement>(null), rsiRef = useRef<HTMLDivElement>(null), macdRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const charts: IChartApi[] = [];
    const make = (el: HTMLDivElement | null, h: number) => {
      if (!el) return null;
      const c = createChart(el, { ...OPTS, height: h, width: el.clientWidth });
      charts.push(c);
      return c;
    };
    const line = (c: IChartApi, values: (number | null)[], color: string, title: string) => {
      const s = c.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, title });
      s.setData(data.candles.flatMap((k, i) => (values[i] == null ? [] : [{ time: ist(k.time), value: values[i] as number }])));
    };
    const pc = make(priceRef.current, 320);
    if (pc) {
      const candle = pc.addCandlestickSeries({ upColor: "#10b981", downColor: "#ef4444", borderVisible: false, wickUpColor: "#10b981", wickDownColor: "#ef4444" });
      candle.setData(data.candles.map((k) => ({ time: ist(k.time), open: k.open, high: k.high, low: k.low, close: k.close })));
      line(pc, data.ema20, "#38bdf8", "EMA 20");
      line(pc, data.ema50, "#f59e0b", "EMA 50");
      line(pc, data.ema200, "#22c55e", "EMA 200");
      pc.timeScale().fitContent();
    }
    const vc = make(volRef.current, 110);
    if (vc) {
      const vol = vc.addHistogramSeries({ priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
      vol.setData(data.candles.map((k, i) => ({ time: ist(k.time), value: data.volume[i] ?? 0, color: k.close >= k.open ? "rgba(16,185,129,0.6)" : "rgba(239,68,68,0.6)" })));
      vc.timeScale().fitContent();
    }
    const rc = make(rsiRef.current, 150);
    if (rc) {
      const s = rc.addLineSeries({ color: "#a78bfa", lineWidth: 2, priceLineVisible: false, title: "RSI 14" });
      s.setData(data.candles.flatMap((k, i) => (data.rsi14[i] == null ? [] : [{ time: ist(k.time), value: data.rsi14[i] as number }])));
      s.createPriceLine({ price: 70, color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
      s.createPriceLine({ price: 30, color: "#10b981", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });
      rc.timeScale().fitContent();
    }
    const mc = make(macdRef.current, 150);
    if (mc) {
      const hist = mc.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
      hist.setData(data.candles.flatMap((k, i) => {
        const m = data.macd[i], sg = data.macdSignal[i];
        if (m == null || sg == null) return [];
        const d = m - sg;
        return [{ time: ist(k.time), value: d, color: d >= 0 ? "rgba(16,185,129,0.7)" : "rgba(239,68,68,0.7)" }];
      }));
      line(mc, data.macd, "#38bdf8", "MACD");
      line(mc, data.macdSignal, "#f97316", "Signal");
      mc.timeScale().fitContent();
    }
    return () => charts.forEach((c) => c.remove());
  }, [data]);
  return (
    <div className="grid gap-3">
      <div className="text-xs text-slate-400">Price with EMA 20 (blue), EMA 50 (amber), EMA 200 (green)</div>
      <div ref={priceRef} className="w-full" data-testid="tech-price" />
      <div className="text-xs text-slate-400">Volume</div>
      <div ref={volRef} className="w-full" data-testid="tech-volume" />
      <div className="text-xs text-slate-400">RSI 14 (70 and 30 marked)</div>
      <div ref={rsiRef} className="w-full" data-testid="tech-rsi" />
      <div className="text-xs text-slate-400">MACD histogram (MACD minus signal), with MACD and signal lines</div>
      <div ref={macdRef} className="w-full" data-testid="tech-macd" />
    </div>
  );
}

export function TechnicalAnalysis() {
  const src = useDataSource();
  const [symbol, setSymbol] = useState("RELIANCE");
  const [interval, setInterval] = useState("5");
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const q = useQuery({ queryKey: ["indicators", symbol, interval], queryFn: () => api<IndicatorSnapshot>(`/indicators/${symbol}?interval=${interval}`) });
  const chart = useQuery({ queryKey: ["tech-chart", symbol, interval], queryFn: () => api<ChartPayload>(`/chart/${symbol}?interval=${interval === "D" ? "D" : interval}&days=20`) });
  const v = q.data?.values ?? {};
  const s = q.data?.summary;
  const card = (label: string, value: number | null | undefined, digits = 2) => <Tile label={label} value={value == null ? "n/a" : fmtNum(value, digits)} />;

  return (
    <div className="grid gap-4">
      <Card title={`Technical analysis · ${symbol} · ${TIMEFRAMES.find(([t]) => t === interval)?.[1] ?? interval} · ${src.word}`} actions={
        <div className="flex flex-wrap gap-2">
          <select className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
            {(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}
          </select>
          <select className={input} value={interval} onChange={(e) => setInterval(e.target.value)} aria-label="Timeframe">
            {TIMEFRAMES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}
          </select>
        </div>
      }>
        <ErrorBox error={q.error ?? chart.error} />
        {q.data ? (
          <p className="text-sm text-slate-300">Last close <span className="font-semibold">{fmtMoney(q.data.close)}</span> · <span className={(q.data.changePct ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}>{fmtPct(q.data.changePct ?? 0)}</span> vs previous session · as of {new Date(q.data.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>
        ) : !q.error && <p className="text-sm text-slate-500">Loading…</p>}
      </Card>

      {q.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {card("EMA 20", v.ema20)}{card("EMA 50", v.ema50)}{card("EMA 200", v.ema200)}{card("RSI 14", v.rsi14, 1)}
          {card("MACD", v.macd, 2)}{card("ADX 14", v.adx14, 1)}{card("Relative volume", v.relativeVolume)}{card("ATR 14", v.atr14)}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title={`Charts · ${src.word}`}>
          {chart.data ? <Panels data={chart.data} /> : <Empty>{chart.isLoading ? "Loading charts…" : "No chart data."}</Empty>}
        </Card>
        <Card title="Technical summary">
          {!s ? <Empty>Loading…</Empty> : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-400">Trend</dt><dd className={tone(s.trend)}>{s.trend}</dd>
              <dt className="text-slate-400">Momentum</dt><dd className={tone(s.momentum)}>{s.momentum}</dd>
              <dt className="text-slate-400">Volume</dt><dd className={tone(s.volume)}>{s.volume}</dd>
              <dt className="text-slate-400">EMA alignment</dt><dd>{s.emaAlignment}</dd>
              <dt className="text-slate-400">Support levels</dt><dd>{s.supportLevels.length ? s.supportLevels.map((x) => fmtMoney(x)).join(", ") : "none found"}</dd>
              <dt className="text-slate-400">Resistance levels</dt><dd>{s.resistanceLevels.length ? s.resistanceLevels.map((x) => fmtMoney(x)).join(", ") : "none found"}</dd>
            </dl>
          )}
          {s && <p className="mt-4 rounded border border-slate-700 bg-slate-900/60 p-3 text-sm">{s.final}</p>}
          <p className="mt-3 text-xs text-slate-500">{q.data?.note}</p>
        </Card>
      </div>
    </div>
  );
}
