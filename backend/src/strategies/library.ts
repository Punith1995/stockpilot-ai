/**
 * Five simple, widely used long-only setups. Each is a rule set, not a promise of profit.
 * Every decision uses only bars up to and including the signal bar (no look-ahead).
 */
import type { Candle } from "../domain/candles.js";
import { istParts } from "../domain/candles.js";
import { adx, atr, bollinger, ema, macd, rsi, sma } from "../indicators/index.js";

/** Supertrend direction per bar: 1 = up (price above the lower band), -1 = down, null during warm-up. Uses only bars up to i. */
export function supertrendDirection(candles: Candle[], period = 10, mult = 3): (1 | -1 | null)[] {
  const a = atr(candles, period);
  const n = candles.length;
  const out: (1 | -1 | null)[] = new Array(n).fill(null);
  let finalUpper = NaN, finalLower = NaN, prevClose = NaN, dir: 1 | -1 = 1;
  for (let i = 0; i < n; i++) {
    const av = a[i];
    if (av == null) continue;
    const mid = (candles[i].high + candles[i].low) / 2;
    const up = mid + mult * av, low = mid - mult * av;
    finalUpper = Number.isNaN(finalUpper) || up < finalUpper || prevClose > finalUpper ? up : finalUpper;
    finalLower = Number.isNaN(finalLower) || low > finalLower || prevClose < finalLower ? low : finalLower;
    if (dir === -1 && candles[i].close > finalUpper) dir = 1;
    else if (dir === 1 && candles[i].close < finalLower) dir = -1;
    out[i] = dir;
    prevClose = candles[i].close;
  }
  return out;
}

export type Series = (number | null)[];
export interface Prepared { candles: Candle[]; [key: string]: unknown }
export type ExitMode = "NEXT_OPEN" | "NOW" | null;

export interface SimpleStrategy {
  id: string;
  name: string;
  summary: string;
  bestFor: string;
  product: "DELIVERY" | "INTRADAY";
  maxHoldBars: number;
  prepare(candles: Candle[]): Prepared;
  /** Entry signal on bar i (closed bar). */
  buy(p: Prepared, i: number): boolean;
  /** Protective stop price for a long entered near `entry`. */
  stop(p: Prepared, i: number, entry: number): number | null;
  /** Reward multiple of risk for the target. */
  targetR: number;
  /** ATR multiple used by the stop, when the stop is entry minus k × ATR(14). Editable in the library. */
  stopAtr?: number;
  /** Discretionary exit on bar i: NOW = close this bar, NEXT_OPEN = fill next bar's open. */
  exit(p: Prepared, i: number): ExitMode;
}

const crossedUp = (a: Series, b: Series, i: number) => i >= 1 && a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i - 1]! <= b[i - 1]! && a[i]! > b[i]!;
const crossedDown = (a: Series, b: Series, i: number) => i >= 1 && a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i - 1]! >= b[i - 1]! && a[i]! < b[i]!;
const minutesOf = (ms: number) => istParts(ms).minutes;

export const SIMPLE_STRATEGIES: SimpleStrategy[] = [
  {
    id: "ema-crossover",
    name: "EMA 20/50 Crossover",
    summary: "Buy when the 20-period EMA crosses above the 50-period EMA. Exit when it crosses back below.",
    bestFor: "Trending stocks on daily or higher bars",
    product: "DELIVERY",
    maxHoldBars: 60,
    targetR: 3,
    stopAtr: 2,
    prepare(candles) {
      const closes = candles.map((c) => c.close);
      return { candles, e20: ema(closes, 20), e50: ema(closes, 50), atr14: atr(candles, 14) };
    },
    buy(p, i) { return crossedUp(p.e20 as Series, p.e50 as Series, i); },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 2 * a; },
    exit(p, i) { return crossedDown(p.e20 as Series, p.e50 as Series, i) ? "NEXT_OPEN" : null; },
  },
  {
    id: "rsi-reversion",
    name: "RSI Oversold Bounce",
    summary: "Buy when RSI(14) rises back above 30 after being oversold. Exit when RSI reaches 60.",
    bestFor: "Range-bound stocks that bounce after sharp falls",
    product: "DELIVERY",
    maxHoldBars: 15,
    targetR: 1.5,
    stopAtr: 1.5,
    prepare(candles) {
      const closes = candles.map((c) => c.close);
      return { candles, rsi14: rsi(closes, 14), atr14: atr(candles, 14) };
    },
    buy(p, i) {
      const r = p.rsi14 as Series;
      return i >= 1 && r[i] != null && r[i - 1] != null && r[i - 1]! <= 30 && r[i]! > 30;
    },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 1.5 * a; },
    exit(p, i) { const r = (p.rsi14 as Series)[i]; return r != null && r >= 60 ? "NEXT_OPEN" : null; },
  },
  {
    id: "macd-crossover",
    name: "MACD Signal Crossover",
    summary: "Buy when the MACD line crosses above its signal line while below zero. Exit when it crosses back below.",
    bestFor: "Swing trades after a pullback",
    product: "DELIVERY",
    maxHoldBars: 30,
    targetR: 2,
    stopAtr: 1.5,
    prepare(candles) {
      const closes = candles.map((c) => c.close);
      const m = macd(closes);
      return { candles, macdLine: m.macd, macdSig: m.signal, atr14: atr(candles, 14) };
    },
    buy(p, i) {
      const line = p.macdLine as Series, sig = p.macdSig as Series;
      return crossedUp(line, sig, i) && line[i]! < 0;
    },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 1.5 * a; },
    exit(p, i) { return crossedDown(p.macdLine as Series, p.macdSig as Series, i) ? "NEXT_OPEN" : null; },
  },
  {
    id: "bollinger-bounce",
    name: "Bollinger Lower-Band Bounce",
    summary: "Buy when price closes back above the lower Bollinger band after touching it. Exit at the middle band.",
    bestFor: "Mean-reverting stocks in a sideways market",
    product: "DELIVERY",
    maxHoldBars: 20,
    targetR: 1.5,
    stopAtr: 1.5,
    prepare(candles) {
      const closes = candles.map((c) => c.close);
      const bb = bollinger(closes, 20, 2);
      return { candles, mid: bb.mid, lower: bb.lower, atr14: atr(candles, 14) };
    },
    buy(p, i) {
      const lo = p.lower as Series, c = (p.candles as Candle[]);
      return i >= 1 && lo[i] != null && lo[i - 1] != null && c[i - 1].close < lo[i - 1]! && c[i].close >= lo[i]!;
    },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 1.5 * a; },
    exit(p, i) {
      const mid = (p.mid as Series)[i], c = (p.candles as Candle[])[i];
      return mid != null && c.close >= mid ? "NEXT_OPEN" : null;
    },
  },
  {
    id: "opening-range-breakout",
    name: "Opening Range Breakout (intraday)",
    summary: "Mark the high of the first 15 minutes (09:15–09:30). Buy the first close above it. Exit by 15:15 the same day.",
    bestFor: "Liquid stocks on intraday 1 or 5 minute bars",
    product: "INTRADAY",
    maxHoldBars: 400,
    targetR: 2,
    prepare(candles) {
      const n = candles.length;
      const firstBreak: boolean[] = new Array(n).fill(false);
      const orHigh: Series = new Array(n).fill(null);
      const orLow: Series = new Array(n).fill(null);
      let day = -1, rh = -Infinity, rl = Infinity, rangeDone = false, broke = false;
      for (let i = 0; i < n; i++) {
        const dayKey = istParts(candles[i].time).dayKey;
        const m = minutesOf(candles[i].time);
        if (dayKey !== day) { day = dayKey; rh = -Infinity; rl = Infinity; rangeDone = false; broke = false; }
        if (m >= 555 && m < 570) { rh = Math.max(rh, candles[i].high); rl = Math.min(rl, candles[i].low); }
        if (m >= 570) rangeDone = true;
        if (rangeDone && Number.isFinite(rh)) { orHigh[i] = rh; orLow[i] = rl; }
        if (rangeDone && !broke && m >= 570 && m < 915 && candles[i].close > rh) {
          firstBreak[i] = true; broke = true;
        }
      }
      return { candles, firstBreak, orHigh, orLow };
    },
    buy(p, i) { return (p.firstBreak as boolean[])[i]; },
    stop(p, i) { const l = (p.orLow as Series)[i]; return l ?? null; },
    exit(p, i) { return minutesOf((p.candles as Candle[])[i].time) >= 915 ? "NOW" : null; },
  },
  {
    id: "rsi-momentum",
    name: "RSI Momentum",
    summary: "Buy when RSI(14) crosses up through 55 while the 50 EMA is rising. Exit when RSI falls back below 50.",
    bestFor: "Stocks in a steady uptrend that are gaining momentum",
    product: "DELIVERY",
    maxHoldBars: 30,
    targetR: 2,
    stopAtr: 1.5,
    prepare(candles) {
      const closes = candles.map((c) => c.close);
      return { candles, rsi14: rsi(closes, 14), e50: ema(closes, 50), atr14: atr(candles, 14) };
    },
    buy(p, i) {
      const r = p.rsi14 as Series, e = p.e50 as Series;
      return i >= 1 && r[i] != null && r[i - 1] != null && r[i - 1]! <= 55 && r[i]! > 55 && e[i] != null && e[i - 1] != null && e[i]! > e[i - 1]!;
    },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 1.5 * a; },
    exit(p, i) { const r = (p.rsi14 as Series)[i]; return r != null && r < 50 ? "NEXT_OPEN" : null; },
  },
  {
    id: "supertrend",
    name: "Supertrend (10, 3)",
    summary: "Buy when the Supertrend flips from down to up (ATR 10 × 3 bands). Exit when it flips back down.",
    bestFor: "Trending stocks on 15 minute or daily bars",
    product: "DELIVERY",
    maxHoldBars: 60,
    targetR: 2,
    stopAtr: 2,
    prepare(candles) {
      const st = supertrendDirection(candles, 10, 3);
      return { candles, dir: st, atr14: atr(candles, 14) };
    },
    buy(p, i) {
      const d = p.dir as (1 | -1 | null)[];
      return i >= 1 && d[i] === 1 && d[i - 1] === -1;
    },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 2 * a; },
    exit(p, i) { return (p.dir as (1 | -1 | null)[])[i] === -1 ? "NEXT_OPEN" : null; },
  },
  {
    id: "breakout-hunter",
    name: "Breakout Hunter (20-bar high)",
    summary: "Buy when a close breaks above the highest high of the previous 20 bars. Exit when a close falls below the lowest low of the previous 10 bars.",
    bestFor: "Stocks that trend after consolidating in a range",
    product: "DELIVERY",
    maxHoldBars: 40,
    targetR: 2.5,
    stopAtr: 1.5,
    prepare(candles) {
      return { candles, atr14: atr(candles, 14) };
    },
    buy(p, i) {
      const c = p.candles as Candle[];
      if (i < 20) return false;
      let hi = -Infinity;
      for (let k = i - 20; k < i; k++) hi = Math.max(hi, c[k].high);
      return c[i].close > hi;
    },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 1.5 * a; },
    exit(p, i) {
      const c = p.candles as Candle[];
      if (i < 10) return null;
      let lo = Infinity;
      for (let k = i - 10; k < i; k++) lo = Math.min(lo, c[k].low);
      return c[i].close < lo ? "NEXT_OPEN" : null;
    },
  },
  {
    id: "pullback-trend",
    name: "Pullback in Uptrend",
    summary: "In an uptrend (50 EMA above 200 EMA), buy when price dips to the 20 EMA and closes back above it. Exit when a close falls below the 50 EMA.",
    bestFor: "Strong stocks that pause before continuing higher",
    product: "DELIVERY",
    maxHoldBars: 40,
    targetR: 2,
    stopAtr: 1.5,
    prepare(candles) {
      const closes = candles.map((c) => c.close);
      return { candles, e20: ema(closes, 20), e50: ema(closes, 50), e200: ema(closes, 200), atr14: atr(candles, 14) };
    },
    buy(p, i) {
      const c = p.candles as Candle[], e20 = p.e20 as Series, e50 = p.e50 as Series, e200 = p.e200 as Series;
      if (i < 1 || e20[i] == null || e50[i] == null || e200[i] == null || e20[i - 1] == null) return false;
      const uptrend = e50[i]! > e200[i]!;
      return uptrend && c[i].low <= e20[i]! && c[i].close > e20[i]! && c[i - 1].close <= e20[i - 1]! * 1.02;
    },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 1.5 * a; },
    exit(p, i) {
      const c = p.candles as Candle[], e50 = p.e50 as Series;
      return e50[i] != null && c[i].close < e50[i]! ? "NEXT_OPEN" : null;
    },
  },
  {
    id: "volume-breakout",
    name: "Volume Breakout",
    summary: "Buy when a close breaks the previous 20-bar high on volume at least 1.5 times its 20-bar average. Exit when a close falls below the 20 EMA.",
    bestFor: "Stocks with news or accumulation showing up as heavy volume",
    product: "DELIVERY",
    maxHoldBars: 30,
    targetR: 2,
    stopAtr: 1.5,
    prepare(candles) {
      const closes = candles.map((c) => c.close);
      return { candles, e20: ema(closes, 20), volAvg: sma(candles.map((c) => c.volume), 20), atr14: atr(candles, 14) };
    },
    buy(p, i) {
      const c = p.candles as Candle[], va = p.volAvg as Series;
      if (i < 20 || va[i - 1] == null) return false;
      let hi = -Infinity;
      for (let k = i - 20; k < i; k++) hi = Math.max(hi, c[k].high);
      return c[i].close > hi && c[i].volume >= 1.5 * va[i - 1]!;
    },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 1.5 * a; },
    exit(p, i) {
      const c = p.candles as Candle[], e20 = p.e20 as Series;
      return e20[i] != null && c[i].close < e20[i]! ? "NEXT_OPEN" : null;
    },
  },
  {
    id: "golden-cross-50-200",
    name: "Golden Cross (50/200 EMA)",
    summary: "Buy when the 50 EMA crosses above the 200 EMA. Exit when it crosses back below.",
    bestFor: "Long, slow trends on daily bars",
    product: "DELIVERY",
    maxHoldBars: 120,
    targetR: 3,
    stopAtr: 2,
    prepare(candles) {
      const closes = candles.map((c) => c.close);
      return { candles, e50: ema(closes, 50), e200: ema(closes, 200), atr14: atr(candles, 14) };
    },
    buy(p, i) { return crossedUp(p.e50 as Series, p.e200 as Series, i); },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 2 * a; },
    exit(p, i) { return crossedDown(p.e50 as Series, p.e200 as Series, i) ? "NEXT_OPEN" : null; },
  },
  {
    id: "rsi2-pullback",
    name: "RSI-2 Pullback",
    summary: "In an uptrend (close above the 200 EMA), buy when RSI(2) falls below 10. Exit when RSI(2) rises above 70.",
    bestFor: "Short dips inside a strong uptrend, usually on daily bars",
    product: "DELIVERY",
    maxHoldBars: 10,
    targetR: 2,
    stopAtr: 2,
    prepare(candles) {
      const closes = candles.map((c) => c.close);
      return { candles, rsi2: rsi(closes, 2), e200: ema(closes, 200), atr14: atr(candles, 14) };
    },
    buy(p, i) {
      const c = p.candles as Candle[], r = p.rsi2 as Series, e = p.e200 as Series;
      return r[i] != null && e[i] != null && c[i].close > e[i]! && r[i]! < 10;
    },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 2 * a; },
    exit(p, i) { const r = (p.rsi2 as Series)[i]; return r != null && r > 70 ? "NOW" : null; },
  },
  {
    id: "macd-zero-cross",
    name: "MACD Zero Cross",
    summary: "Buy when the MACD line (12, 26) crosses above zero. Exit when it crosses back below zero.",
    bestFor: "Stocks that turn from a downtrend into an uptrend",
    product: "DELIVERY",
    maxHoldBars: 60,
    targetR: 2,
    stopAtr: 2,
    prepare(candles) {
      const closes = candles.map((c) => c.close);
      const zero = closes.map(() => 0);
      return { candles, macdLine: macd(closes).macd, zero, atr14: atr(candles, 14) };
    },
    buy(p, i) { return crossedUp(p.macdLine as Series, p.zero as Series, i); },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 2 * a; },
    exit(p, i) { return crossedDown(p.macdLine as Series, p.zero as Series, i) ? "NEXT_OPEN" : null; },
  },
  {
    id: "adx-di-cross",
    name: "ADX Directional Cross",
    summary: "Buy when +DI crosses above -DI while ADX(14) is at least 20. Exit when -DI crosses above +DI.",
    bestFor: "Stocks with a clear, strengthening trend",
    product: "DELIVERY",
    maxHoldBars: 40,
    targetR: 2,
    stopAtr: 2,
    prepare(candles) {
      const a = adx(candles, 14);
      return { candles, adx: a.adx, plusDI: a.plusDI, minusDI: a.minusDI, atr14: atr(candles, 14) };
    },
    buy(p, i) {
      const adxV = (p.adx as Series)[i];
      return adxV != null && adxV >= 20 && crossedUp(p.plusDI as Series, p.minusDI as Series, i);
    },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 2 * a; },
    exit(p, i) { return crossedDown(p.plusDI as Series, p.minusDI as Series, i) ? "NEXT_OPEN" : null; },
  },
  {
    id: "bollinger-squeeze",
    name: "Bollinger Squeeze Breakout",
    summary: "Buy when a close breaks above the upper Bollinger band (20, 2) right after the band width hits its lowest level in 50 bars. Exit when the close falls below the middle band.",
    bestFor: "Stocks coming out of a quiet, tight range",
    product: "DELIVERY",
    maxHoldBars: 30,
    targetR: 2.5,
    stopAtr: 1.5,
    prepare(candles) {
      const closes = candles.map((c) => c.close);
      const bb = bollinger(closes, 20, 2);
      return { candles, upper: bb.upper, mid: bb.mid, width: bb.bandwidth, atr14: atr(candles, 14) };
    },
    buy(p, i) {
      const c = p.candles as Candle[], w = p.width as Series, u = p.upper as Series;
      if (i < 51 || w[i - 1] == null || u[i] == null) return false;
      let minW = Infinity;
      for (let k = i - 51; k < i - 1; k++) if (w[k] != null) minW = Math.min(minW, w[k]!);
      return w[i - 1]! <= minW && c[i].close > u[i]!;
    },
    stop(p, i, entry) { const a = (p.atr14 as Series)[i]; return a == null ? null : entry - 1.5 * a; },
    exit(p, i) {
      const c = p.candles as Candle[], m = p.mid as Series;
      return m[i] != null && c[i].close < m[i]! ? "NEXT_OPEN" : null;
    },
  },
];

export const strategyById = (id: string) => SIMPLE_STRATEGIES.find((s) => s.id === id);
