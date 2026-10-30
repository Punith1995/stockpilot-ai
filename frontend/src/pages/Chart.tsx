import { useEffect, useRef, useState } from "react";
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Candle, Instrument } from "../types";
import { Card, ErrorBox, input } from "../components/Card";

export function Chart() {
  const [symbol, setSymbol] = useState("RELIANCE");
  const [interval, setInterval] = useState("5");
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const candles = useQuery({
    queryKey: ["candles", symbol, interval],
    queryFn: () => api<{ candles: Candle[] }>(`/candles/${symbol}?interval=${interval}&days=20`),
  });
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, { height: 420, layout: { background: { color: "#0f172a" }, textColor: "#cbd5e1" }, grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } }, timeScale: { timeVisible: true } });
    chartRef.current = chart;
    seriesRef.current = chart.addCandlestickSeries({ upColor: "#10b981", downColor: "#ef4444", borderVisible: false, wickUpColor: "#10b981", wickDownColor: "#ef4444" });
    const onResize = () => ref.current && chart.applyOptions({ width: ref.current.clientWidth });
    onResize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  useEffect(() => {
    if (!candles.data || !seriesRef.current) return;
    // Shift by +5:30 so the chart's UTC axis shows IST wall-clock time.
    seriesRef.current.setData(candles.data.candles.map((c) => ({ time: (Math.floor(c.time / 1000) + 19800) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    chartRef.current?.timeScale().fitContent();
  }, [candles.data]);

  return (
    <Card title={`Chart · ${symbol} · ${interval}m · SAMPLE`} actions={
      <div className="flex gap-2">
        <select className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
          {(instruments.data?.items ?? []).map((i) => <option key={i.symbol} value={i.symbol}>{i.symbol}</option>)}
        </select>
        <select className={input} value={interval} onChange={(e) => setInterval(e.target.value)} aria-label="Interval">
          <option value="1">1 min</option><option value="5">5 min</option><option value="15">15 min</option>
        </select>
      </div>
    }>
      <ErrorBox error={candles.error} />
      <div ref={ref} className="w-full" data-testid="chart" />
      <p className="mt-2 text-xs text-slate-500">Times shown in IST. Data is SAMPLE, not real market data.</p>
    </Card>
  );
}
