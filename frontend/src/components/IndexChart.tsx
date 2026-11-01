import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { createChart, type UTCTimestamp } from "lightweight-charts";
import { api } from "../lib/api";
import { Empty, ErrorBox } from "./Card";

interface IndexCandles { source: string; name: string; interval: string; candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[]; note: string }

/** Candlestick chart for one index. Sample data, labelled as such. Times are shifted to IST wall-clock. */
export function IndexChart({ name, interval }: { name: string; interval: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["index-chart", name, interval],
    queryFn: () => api<IndexCandles>(`/indices/${encodeURIComponent(name)}/chart?interval=${interval}&days=20`),
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (!ref.current || !q.data?.candles.length) return;
    const chart = createChart(ref.current, {
      layout: { background: { color: "#0d1528" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      timeScale: { timeVisible: true },
      height: 240,
      width: ref.current.clientWidth,
    });
    const series = chart.addCandlestickSeries({ upColor: "#10b981", downColor: "#ef4444", borderVisible: false, wickUpColor: "#10b981", wickDownColor: "#ef4444" });
    series.setData(q.data.candles.map((c) => ({ time: (Math.floor(c.time / 1000) + 19800) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    chart.timeScale().fitContent();
    const onResize = () => { if (ref.current) chart.applyOptions({ width: ref.current.clientWidth }); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chart.remove(); };
  }, [q.data]);
  return (
    <div>
      <ErrorBox error={q.error} />
      {q.data && !q.data.candles.length ? <Empty>No candles for this timeframe.</Empty> : <div ref={ref} className="w-full" />}
    </div>
  );
}
