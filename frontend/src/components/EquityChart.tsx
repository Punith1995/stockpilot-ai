import { useEffect, useRef } from "react";
import { createChart, type UTCTimestamp } from "lightweight-charts";

/** Equity line plus drawdown area from the running peak. Times are shifted to IST wall-clock. */
export function EquityChart({ equity }: { equity: { time: number; equity: number }[] }) {
  const eqRef = useRef<HTMLDivElement>(null);
  const ddRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!eqRef.current || !ddRef.current || !equity.length) return;
    const opts = {
      layout: { background: { color: "#0d1528" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      timeScale: { timeVisible: true },
    };
    const ec = createChart(eqRef.current, { ...opts, height: 220, width: eqRef.current.clientWidth });
    const dc = createChart(ddRef.current, { ...opts, height: 160, width: ddRef.current.clientWidth });
    const t = (ms: number) => (Math.floor(ms / 1000) + 19800) as UTCTimestamp;
    const line = ec.addLineSeries({ color: "#10b981", lineWidth: 2, priceLineVisible: false });
    line.setData(equity.map((p) => ({ time: t(p.time), value: p.equity })));
    let peak = equity[0].equity;
    const dd = dc.addAreaSeries({ lineColor: "#ef4444", topColor: "rgba(239,68,68,0.35)", bottomColor: "rgba(239,68,68,0.02)", priceLineVisible: false });
    dd.setData(equity.map((p) => { peak = Math.max(peak, p.equity); return { time: t(p.time), value: peak === 0 ? 0 : -((peak - p.equity) / peak) * 100 }; }));
    ec.timeScale().fitContent();
    dc.timeScale().fitContent();
    const onResize = () => {
      if (eqRef.current) ec.applyOptions({ width: eqRef.current.clientWidth });
      if (ddRef.current) dc.applyOptions({ width: ddRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); ec.remove(); dc.remove(); };
  }, [equity]);
  if (!equity.length) return <p className="py-4 text-center text-sm text-slate-500">No equity data.</p>;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div><div className="mb-1 text-xs text-slate-400">Equity curve</div><div ref={eqRef} className="w-full" data-testid="equity-chart" /></div>
      <div><div className="mb-1 text-xs text-slate-400">Drawdown (%)</div><div ref={ddRef} className="w-full" data-testid="drawdown-chart" /></div>
    </div>
  );
}
