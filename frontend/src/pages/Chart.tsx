import { useEffect, useRef, useState } from "react";
import { createChart, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type MouseEventParams, type UTCTimestamp } from "lightweight-charts";
import { useDataSource } from "../lib/source";

import { getDefaultTimeframe, TIMEFRAMES } from "../lib/prefs";
import { chartFreshness } from "../lib/freshness";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { AppStatus, Candle, Instrument } from "../types";
import { btn, Card, ErrorBox, input } from "../components/Card";
import { fmtMoney } from "../lib/format";

interface SetupCheck { label: string; mandatory: boolean; pass: boolean | null; detail: string }
interface SetupPlan { entry: number; stop: number; target1: number; target2: number; riskPerShare: number; qty: number; rewardToRisk: number }
interface Setup { signal: string; passedChecks: number; totalChecks: number; checks: SetupCheck[]; plan: SetupPlan | null; reason: string | null }

interface ChartData { source?: string; markers?: { time: number; price: number; side: "BUY" }[]; levels?: { support: number[]; resistance: number[] }; candles: Candle[]; ema20: (number | null)[]; ema50: (number | null)[]; ema200: (number | null)[]; rsi14: (number | null)[]; macd: (number | null)[]; macdSignal: (number | null)[]; volume: number[]; volumeAvg20: (number | null)[]; adx14: (number | null)[]; atr14: (number | null)[]; setup: Setup }

const OPTS = {
  layout: { background: { color: "#0d1528" }, textColor: "#94a3b8" },
  grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
  timeScale: { timeVisible: true },
  height: 240,
};
/** Shift by +5:30 so the chart's UTC axis reads as IST wall-clock time. */
const ist = (ms: number) => (Math.floor(ms / 1000) + 19800) as UTCTimestamp;

function useChart(ref: React.RefObject<HTMLDivElement>, height: number) {
  const chartRef = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, { ...OPTS, height });
    chartRef.current = chart;
    const onResize = () => ref.current && chart.applyOptions({ width: ref.current.clientWidth });
    onResize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chart.remove(); chartRef.current = null; };
  }, [ref, height]);
  return chartRef;
}

export function Chart() {
  const src = useDataSource();
  const [params] = useSearchParams();
  const [symbol, setSymbol] = useState(() => {
    const q = (params.get("symbol") ?? "").toUpperCase();
    return /^[A-Z0-9&-]{1,20}$/.test(q) ? q : "RELIANCE";
  });
  const [interval, setInterval] = useState(getDefaultTimeframe);
  const [chartType, setChartType] = useState<"candles" | "line">("candles");
  const [drawMode, setDrawMode] = useState(false);
  /** Lower panels can be hidden; they stay mounted so the chart effect keeps working. */
  const [panels, setPanels] = useState({ volume: true, rsi: true, macd: true, adx: true, atr: true });
  const togglePanel = (k: keyof typeof panels) => setPanels((p) => ({ ...p, [k]: !p[k] }));
  /** EMA line visibility. The series are rebuilt with the data, so the current choice is read from a ref. */
  const [emaVis, setEmaVis] = useState({ ema20: true, ema50: true, ema200: true });
  const emaVisRef = useRef(emaVis);
  emaVisRef.current = emaVis;
  const emaSeries = useRef<ISeriesApi<"Line">[]>([]);
  /** Horizontal price lines per symbol, kept in memory for this page session. */
  const [drawings, setDrawings] = useState<Record<string, number[]>>({});
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const appStatus = useQuery({ queryKey: ["status"], queryFn: () => api<AppStatus>("/status"), refetchInterval: 30_000 });
  const data = useQuery({ queryKey: ["chart", symbol, interval], queryFn: () => api<ChartData>(`/chart/${symbol}?interval=${interval}&days=20`) });

  const priceRef = useRef<HTMLDivElement>(null), rsiRef = useRef<HTMLDivElement>(null), macdRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);
  const adxRef = useRef<HTMLDivElement>(null), atrRef = useRef<HTMLDivElement>(null);
  const priceChart = useChart(priceRef, 360), volChart = useChart(volRef, 120), rsiChart = useChart(rsiRef, 150), macdChart = useChart(macdRef, 150);
  const adxChart = useChart(adxRef, 130), atrChart = useChart(atrRef, 130);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const lineRefs = useRef<IPriceLine[]>([]);

  useEffect(() => {
    const pc = priceChart.current, vc = volChart.current, rc = rsiChart.current, mc = macdChart.current;
    const ac = adxChart.current, tc = atrChart.current;
    if (!pc || !vc || !rc || !mc || !ac || !tc || !data.data) return;
    const d = data.data;
    const addLine = (chart: IChartApi, color: string, values: (number | null)[], title: string) => {
      const s = chart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title });
      s.setData(d.candles.flatMap((c, i) => (values[i] == null ? [] : [{ time: ist(c.time), value: values[i] as number }])));
      return s;
    };
    const candle = chartType === "candles"
      ? pc.addCandlestickSeries({ upColor: "#10b981", downColor: "#ef4444", borderVisible: false, wickUpColor: "#10b981", wickDownColor: "#ef4444" })
      : pc.addLineSeries({ color: "#38bdf8", lineWidth: 2, priceLineVisible: false });
    if (chartType === "candles") {
      (candle as ISeriesApi<"Candlestick">).setData(d.candles.map((c) => ({ time: ist(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else {
      (candle as ISeriesApi<"Line">).setData(d.candles.map((c) => ({ time: ist(c.time), value: c.close })));
    }
    candleRef.current = candle as ISeriesApi<"Candlestick">;
    const markerList = (d.markers ?? []).map((m) => ({ time: ist(m.time), position: "belowBar" as const, color: "#10b981", shape: "arrowUp" as const, text: "BUY" }));
    if (chartType === "candles" && markerList.length) (candle as ISeriesApi<"Candlestick">).setMarkers(markerList);
    // Only the nearest support below and nearest resistance above the last close, to keep the chart readable.
    const lastClose = d.candles.at(-1)?.close ?? 0;
    const nearestBelow = (d.levels?.support ?? []).filter((x) => x < lastClose).sort((x, y) => y - x)[0];
    const nearestAbove = (d.levels?.resistance ?? []).filter((x) => x > lastClose).sort((x, y) => x - y)[0];
    if (nearestBelow != null) candle.createPriceLine({ price: nearestBelow, color: "#10b981", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "Support" });
    if (nearestAbove != null) candle.createPriceLine({ price: nearestAbove, color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "Resistance" });
    const e20 = addLine(pc, "#38bdf8", d.ema20, "EMA 20");
    const e50 = addLine(pc, "#f59e0b", d.ema50, "EMA 50");
    const e200 = addLine(pc, "#22c55e", d.ema200, "EMA 200");
    emaSeries.current = [e20, e50, e200];
    const vis = emaVisRef.current;
    e20.applyOptions({ visible: vis.ema20 });
    e50.applyOptions({ visible: vis.ema50 });
    e200.applyOptions({ visible: vis.ema200 });
    const vol = vc.addHistogramSeries({ priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    vol.setData(d.candles.map((c, i) => ({ time: ist(c.time), value: d.volume[i] ?? 0, color: c.close >= c.open ? "rgba(16,185,129,0.6)" : "rgba(239,68,68,0.6)" })));
    const volAvg = addLine(vc, "#38bdf8", d.volumeAvg20, "20-bar avg");
    volAvg.applyOptions({ lineStyle: LineStyle.Dashed, lineWidth: 1 });
    const rsi = addLine(rc, "#a78bfa", d.rsi14, "RSI 14");
    rsi.createPriceLine({ price: 70, color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
    rsi.createPriceLine({ price: 30, color: "#10b981", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });
    const macdLine = addLine(mc, "#38bdf8", d.macd, "MACD");
    const sig = addLine(mc, "#f97316", d.macdSignal, "Signal");
    const adxLine = addLine(ac, "#facc15", d.adx14, "ADX 14");
    const atrLine = addLine(tc, "#fb7185", d.atr14, "ATR 14");
    pc.timeScale().fitContent();
    vc.timeScale().fitContent();
    rc.timeScale().fitContent();
    mc.timeScale().fitContent();
    ac.timeScale().fitContent();
    tc.timeScale().fitContent();
    return () => {
      candleRef.current = null;
      emaSeries.current = [];
      lineRefs.current = [];
      pc.removeSeries(candle); pc.removeSeries(e20); pc.removeSeries(e50); pc.removeSeries(e200);
      vc.removeSeries(vol); vc.removeSeries(volAvg);
      rc.removeSeries(rsi); mc.removeSeries(macdLine); mc.removeSeries(sig);
      ac.removeSeries(adxLine); tc.removeSeries(atrLine);
    };
  }, [data.data, priceChart, volChart, rsiChart, macdChart, adxChart, atrChart, chartType]);

  // Show or hide the EMA lines without rebuilding the chart.
  useEffect(() => {
    const [a, b, c] = emaSeries.current;
    a?.applyOptions({ visible: emaVis.ema20 });
    b?.applyOptions({ visible: emaVis.ema50 });
    c?.applyOptions({ visible: emaVis.ema200 });
  }, [emaVis]);

  // Click on the price panel to add a horizontal line at that price (only in draw mode).
  useEffect(() => {
    const pc = priceChart.current;
    if (!pc || !drawMode) return;
    const onClick = (param: MouseEventParams) => {
      const series = candleRef.current;
      if (!series || !param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;
      const p = Math.round(Number(price) * 100) / 100;
      setDrawings((prev) => ({ ...prev, [symbol]: [...(prev[symbol] ?? []), p] }));
    };
    pc.subscribeClick(onClick);
    return () => pc.unsubscribeClick(onClick);
  }, [drawMode, symbol, priceChart]);

  // Draw the saved horizontal lines for the current symbol on the candle series.
  useEffect(() => {
    const series = candleRef.current;
    for (const l of lineRefs.current) { try { series?.removePriceLine(l); } catch { /* series was rebuilt */ } }
    lineRefs.current = [];
    if (!series) return;
    for (const p of drawings[symbol] ?? []) {
      lineRefs.current.push(series.createPriceLine({ price: p, color: "#facc15", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "Line" }));
    }
    const plan = data.data?.setup.plan;
    if (plan) {
      const tags: [number, string, string, LineStyle][] = [
        [plan.entry, "#3b82f6", `Entry ${fmtMoney(plan.entry)}`, LineStyle.Solid],
        [plan.stop, "#ef4444", `Stop ${fmtMoney(plan.stop)}`, LineStyle.Solid],
        [plan.target1, "#10b981", `Target 1 ${fmtMoney(plan.target1)}`, LineStyle.Dashed],
        [plan.target2, "#10b981", `Target 2 ${fmtMoney(plan.target2)}`, LineStyle.Dashed],
      ];
      for (const [price, color, title, lineStyle] of tags) {
        lineRefs.current.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle, axisLabelVisible: true, title }));
      }
    }
  }, [drawings, symbol, data.data]);

  const setup = data.data?.setup;

  const lineCount = (drawings[symbol] ?? []).length;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card title={`Advanced charts · ${symbol} · ${TIMEFRAMES.find(([v]) => v === interval)?.[1] ?? interval} · ${src.word}`} actions={
        <div className="flex flex-wrap gap-2">
          <select className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
            {(instruments.data?.items ?? []).map((i) => <option key={i.symbol} value={i.symbol}>{i.symbol}</option>)}
          </select>
          <select className={input} value={interval} onChange={(e) => setInterval(e.target.value)} aria-label="Interval">
            {TIMEFRAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className={input} value={chartType} onChange={(e) => setChartType(e.target.value as "candles" | "line")} aria-label="Chart type">
            <option value="candles">Candles</option><option value="line">Line</option>
          </select>
          <select className={input} value="NSE" onChange={() => undefined} aria-label="Exchange">
            <option value="NSE">NSE</option><option value="BSE" disabled>BSE (not in this version)</option>
          </select>
          {(["ema20", "ema50", "ema200"] as const).map((k) => (
            <button key={k} className={btn} aria-pressed={emaVis[k]} onClick={() => setEmaVis((v) => ({ ...v, [k]: !v[k] }))}>{emaVis[k] ? "Hide" : "Show"} {k.replace("ema", "EMA ")}</button>
          ))}
          {(["volume", "rsi", "macd", "adx", "atr"] as const).map((k) => (
            <button key={k} className={btn} aria-pressed={panels[k]} onClick={() => togglePanel(k)}>{panels[k] ? "Hide" : "Show"} {k === "volume" ? "volume" : k.toUpperCase()}</button>
          ))}
          <button className={btn} aria-pressed={drawMode} onClick={() => setDrawMode((m) => !m)}>{drawMode ? "Drawing: on" : "Draw horizontal line"}</button>
          <button className={btn} onClick={() => setDrawings((prev) => ({ ...prev, [symbol]: [] }))} disabled={!lineCount}>Clear lines</button>
        </div>
      }>
        <ErrorBox error={data.error} />
        <div className="mb-1 text-xs text-slate-400">Price with EMA 20 (blue), EMA 50 (amber) and EMA 200 (green){drawMode ? " · click the chart to place a line" : ""}{lineCount ? ` · ${lineCount} line(s) on ${symbol}` : ""}</div>
        <div className="relative">
          <div ref={priceRef} className="w-full" data-testid="price-chart" />
          <div className="pointer-events-none absolute left-3 top-2 z-10 rounded bg-[#0d1528]/80 px-2 py-1 text-xs text-slate-200" data-testid="chart-legend">
            <div className="font-semibold">Stock: {symbol}</div>
            <div>Time frame: {TIMEFRAMES.find(([v]) => v === interval)?.[1] ?? interval} ({src.word})</div>
            <div className="mt-1 text-sky-400">— EMA 20</div>
            <div className="text-amber-400">— EMA 50</div>
            <div className="text-emerald-400">— EMA 200</div>
          </div>
        </div>
        <div className={`mb-1 mt-3 text-xs text-slate-400 ${panels.volume ? "" : "hidden"}`}>Volume with 20-bar average (dashed)</div>
        <div ref={volRef} className={`w-full ${panels.volume ? "" : "hidden"}`} data-testid="volume-chart" />
        <div className={`mb-1 mt-3 text-xs text-slate-400 ${panels.rsi ? "" : "hidden"}`}>RSI 14 (70 and 30 marked)</div>
        <div ref={rsiRef} className={`w-full ${panels.rsi ? "" : "hidden"}`} data-testid="rsi-chart" />
        <div className={`mb-1 mt-3 text-xs text-slate-400 ${panels.macd ? "" : "hidden"}`}>MACD and signal</div>
        <div ref={macdRef} className={`w-full ${panels.macd ? "" : "hidden"}`} data-testid="macd-chart" />
        <div className={`mb-1 mt-3 text-xs text-slate-400 ${panels.adx ? "" : "hidden"}`}>ADX 14 (above 20 means a trending market)</div>
        <div ref={adxRef} className={`w-full ${panels.adx ? "" : "hidden"}`} data-testid="adx-chart" />
        <div className={`mb-1 mt-3 text-xs text-slate-400 ${panels.atr ? "" : "hidden"}`}>ATR 14 (typical bar range, used for stops)</div>
        <div ref={atrRef} className={`w-full ${panels.atr ? "" : "hidden"}`} data-testid="atr-chart" />
        <p className="mt-2 text-xs text-slate-500">Times shown in IST. {src.live ? "Data is live from Kite." : "Data is SAMPLE, not real market data."} Lines are kept in this browser tab only and reset on reload.</p>
      </Card>

      <div className="flex flex-col gap-4">
        <Card title="Market data and indicators">
          {(() => {
            const d = data.data;
            const last = d?.candles.at(-1), prev = d?.candles.at(-2);
            const lastIdx = (arr?: (number | null)[]) => (arr ? arr.at(-1) ?? null : null);
            const changePct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : null;
            const fmt = (v: number | null | undefined, digits = 2) => (v == null ? "—" : v.toFixed(digits));
            const live = Boolean(appStatus.data?.kite.connected) && d?.source === "KITE";
            const ageMs = last ? Date.now() - last.time : null;
            const barMinutes = interval === "D" ? 1440 : Number(interval);
            const freshness = chartFreshness({ live, ageMs, barMinutes });
            return d ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-slate-400">Data source</dt><dd><span className={`rounded px-2 py-0.5 text-xs ${live ? "bg-emerald-900/40 text-emerald-200" : "bg-amber-900/40 text-amber-200"}`}>{live ? "Kite live feed" : "SAMPLE · Kite not connected"}</span></dd>
                <dt className="text-slate-400">Freshness</dt><dd className={freshness.tone}>{freshness.text}</dd>
                <dt className="text-slate-400">Current price</dt><dd>{last ? fmtMoney(last.close) : "—"}</dd>
                <dt className="text-slate-400">Change vs prev bar</dt><dd className={changePct == null ? "" : changePct >= 0 ? "text-emerald-400" : "text-red-400"}>{changePct == null ? "—" : `${changePct.toFixed(2)}%`}</dd>
                <dt className="text-slate-400">Technical signal</dt><dd>{setup?.signal ?? "—"}</dd>
                <dt className="text-slate-400">RSI 14</dt><dd>{fmt(lastIdx(d.rsi14), 1)}</dd>
                <dt className="text-slate-400">MACD vs signal</dt><dd>{lastIdx(d.macd) != null && lastIdx(d.macdSignal) != null ? (lastIdx(d.macd)! > lastIdx(d.macdSignal)! ? "Above" : "Below") : "—"}</dd>
                <dt className="text-slate-400">ADX 14</dt><dd>{fmt(lastIdx(d.adx14), 1)}</dd>
                <dt className="text-slate-400">ATR 14</dt><dd>{fmt(lastIdx(d.atr14))}</dd>
              </dl>
            ) : <p className="text-sm text-slate-500">Loading…</p>;
          })()}
          <p className="mt-3 text-xs text-slate-500">Freshness compares the last bar with the current time. With SAMPLE data it is always labelled not live.</p>
        </Card>

        <Card title={`Trade setup details · ${src.word}`}>
          {setup ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-slate-400">Stock</dt><dd>{symbol}</dd>
                <dt className="text-slate-400">Time frame</dt><dd>{interval} min</dd>
                <dt className="text-slate-400">Last bar</dt><dd>{setup.signal}</dd>
                <dt className="text-slate-400">Checks passed</dt><dd>{setup.passedChecks}/{setup.totalChecks}</dd>
                {setup.plan && <>
                  <dt className="text-slate-400">Entry</dt><dd>{fmtMoney(setup.plan.entry)}</dd>
                  <dt className="text-slate-400">Stop loss</dt><dd>{fmtMoney(setup.plan.stop)}</dd>
                  <dt className="text-slate-400">Target 1</dt><dd>{fmtMoney(setup.plan.target1)} ({setup.plan.rewardToRisk}R)</dd>
                  <dt className="text-slate-400">Target 2</dt><dd>{fmtMoney(setup.plan.target2)} (3R)</dd>
                  <dt className="text-slate-400">Qty (risk-sized)</dt><dd>{setup.plan.qty}</dd>
                </>}
              </dl>
              {!setup.plan && <p className="mt-3 text-xs text-slate-400">No entry or stop on the last bar. {setup.reason ?? ""}</p>}
              <ul className="mt-3 space-y-1 text-xs">
                {setup.checks.map((c) => (
                  <li key={c.label} className="flex gap-2">
                    <span className={c.pass ? "text-emerald-400" : c.pass === false ? "text-red-400" : "text-slate-500"}>{c.pass ? "✓" : c.pass === false ? "✗" : "–"}</span>
                    <span className="text-slate-300">{c.label}{c.mandatory ? " (mandatory)" : ""}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="text-sm text-slate-500">Loading setup…</p>}
        </Card>

        <Card title="Key rules to remember">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
            <li>Trade in the direction of the trend.</li>
            <li>Use EMA 20, 50 and 200 to identify the trend.</li>
            <li>Confirm with RSI, MACD and volume.</li>
            <li>Keep risk per trade at or below 0.5% of capital.</li>
            <li>Aim for at least 2:1 reward-to-risk.</li>
            <li>Size positions from the stop distance.</li>
          </ol>
        </Card>

        <Card title="Important">
          <p className="text-sm text-amber-200">Research and paper trading only. Chart data is {src.word}{src.live ? "" : " (generated)"}. This is not a buy or sell recommendation. Do your own research or consult a financial adviser.</p>
        </Card>
      </div>
    </div>
  );
}
