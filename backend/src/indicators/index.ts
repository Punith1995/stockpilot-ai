/**
 * Technical indicators on plain number arrays / candles.
 *
 * Conventions (documented so results can be checked against other platforms):
 *  - Output arrays have the same length as the input. Values before the indicator
 *    has enough history are `null` (warm-up), never a misleading partial number.
 *  - EMA: seeded with the SMA of the first `period` values, alpha = 2 / (period + 1).
 *  - RSI, ATR, ADX: Wilder smoothing (alpha = 1 / period), seeded with a simple mean.
 *  - Standard deviation (Bollinger): population form (divide by N).
 *  - VWAP resets at the start of each Indian trading day (IST).
 *  - Crossovers use the previous and current bar only: no future data is used.
 */
import type { Candle } from "../domain/candles.js";

export type Series = (number | null)[];
const IST_OFFSET_MS = 19_800_000;
const DAY_MS = 86_400_000;

function nulls(n: number): Series {
  return new Array<number | null>(n).fill(null);
}

export function sma(values: number[], period: number): Series {
  if (period <= 0) throw new Error("period must be positive");
  const out = nulls(values.length);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  if (period <= 0) throw new Error("period must be positive");
  const out = nulls(values.length);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function rsi(closes: number[], period = 14): Series {
  const out = nulls(closes.length);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = rsiValue(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = rsiValue(avgGain, avgLoss);
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line: Series = closes.map((_, i) => (f[i] !== null && s[i] !== null ? f[i]! - s[i]! : null));
  const signal = nulls(closes.length);
  const first = line.findIndex((v) => v !== null);
  if (first >= 0) {
    const sub = line.slice(first) as number[];
    const e = ema(sub, signalPeriod);
    for (let j = 0; j < e.length; j++) signal[first + j] = e[j];
  }
  const histogram: Series = closes.map((_, i) => (line[i] !== null && signal[i] !== null ? line[i]! - signal[i]! : null));
  return { macd: line, signal, histogram };
}

export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
}

export function atr(candles: Candle[], period = 14): Series {
  const out = nulls(candles.length);
  if (candles.length <= period) return out;
  const tr = trueRange(candles);
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function adx(candles: Candle[], period = 14) {
  const n = candles.length;
  const adxOut = nulls(n), plusDI = nulls(n), minusDI = nulls(n);
  if (n <= 2 * period) return { adx: adxOut, plusDI, minusDI };
  const tr = trueRange(candles);
  const plusDM = new Array<number>(n).fill(0), minusDM = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  let sTR = 0, sP = 0, sM = 0;
  for (let i = 1; i <= period; i++) { sTR += tr[i]; sP += plusDM[i]; sM += minusDM[i]; }
  const dx = nulls(n);
  const dxOf = (p: number, m: number) => (p + m > 0 ? (100 * Math.abs(p - m)) / (p + m) : 0);
  plusDI[period] = sTR > 0 ? (100 * sP) / sTR : 0;
  minusDI[period] = sTR > 0 ? (100 * sM) / sTR : 0;
  dx[period] = dxOf(plusDI[period]!, minusDI[period]!);
  for (let i = period + 1; i < n; i++) {
    sTR = sTR - sTR / period + tr[i];
    sP = sP - sP / period + plusDM[i];
    sM = sM - sM / period + minusDM[i];
    plusDI[i] = sTR > 0 ? (100 * sP) / sTR : 0;
    minusDI[i] = sTR > 0 ? (100 * sM) / sTR : 0;
    dx[i] = dxOf(plusDI[i]!, minusDI[i]!);
  }
  let seed = 0;
  for (let i = period; i < 2 * period; i++) seed += dx[i]!;
  let a = seed / period;
  adxOut[2 * period - 1] = a;
  for (let i = 2 * period; i < n; i++) {
    a = (a * (period - 1) + dx[i]!) / period;
    adxOut[i] = a;
  }
  return { adx: adxOut, plusDI, minusDI };
}

export function bollinger(closes: number[], period = 20, k = 2) {
  const mid = sma(closes, period);
  const upper = nulls(closes.length), lower = nulls(closes.length), bandwidth = nulls(closes.length);
  for (let i = period - 1; i < closes.length; i++) {
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (closes[j] - mid[i]!) ** 2;
    const sd = Math.sqrt(v / period);
    upper[i] = mid[i]! + k * sd;
    lower[i] = mid[i]! - k * sd;
    bandwidth[i] = mid[i]! !== 0 ? (upper[i]! - lower[i]!) / mid[i]! : null;
  }
  return { mid, upper, lower, bandwidth };
}

/** Session VWAP, reset each IST trading day. Null while cumulative volume is zero. */
export function vwap(candles: Candle[]): Series {
  const out = nulls(candles.length);
  let day = -1, pv = 0, vol = 0;
  candles.forEach((c, i) => {
    const d = Math.floor((c.time + IST_OFFSET_MS) / DAY_MS);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
    out[i] = vol > 0 ? pv / vol : null;
  });
  return out;
}

/**
 * Relative volume of candle i against the average of the previous `period` completed candles.
 * Returns null for an incomplete candle: a partial bar's volume is not comparable.
 */
export function relativeVolume(volumes: number[], i: number, period = 20, complete = true): number | null {
  if (!complete || i < period) return null;
  let sum = 0;
  for (let j = i - period; j < i; j++) sum += volumes[j];
  const avg = sum / period;
  return avg > 0 ? volumes[i] / avg : null;
}

/** Highest high / lowest low over [from, to] inclusive. */
export function highest(values: number[], from: number, to: number): number | null {
  if (from < 0 || to < from || to >= values.length) return null;
  let m = -Infinity;
  for (let j = from; j <= to; j++) m = Math.max(m, values[j]);
  return m;
}
export function lowest(values: number[], from: number, to: number): number | null {
  if (from < 0 || to < from || to >= values.length) return null;
  let m = Infinity;
  for (let j = from; j <= to; j++) m = Math.min(m, values[j]);
  return m;
}

/** True when series a moved from <= b on bar i-1 to > b on bar i. */
export function crossedAbove(a: Series, b: Series, i: number): boolean {
  if (i < 1 || a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) return false;
  return a[i - 1]! <= b[i - 1]! && a[i]! > b[i]!;
}
export function crossedBelow(a: Series, b: Series, i: number): boolean {
  if (i < 1 || a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) return false;
  return a[i - 1]! >= b[i - 1]! && a[i]! < b[i]!;
}

/** Index of the most recent upward crossover within the last `lookback` bars (inclusive), or null. */
export function lastCrossAbove(a: Series, b: Series, i: number, lookback: number): number | null {
  for (let j = i; j >= Math.max(1, i - lookback + 1); j--) if (crossedAbove(a, b, j)) return j;
  return null;
}
