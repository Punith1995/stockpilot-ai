import { describe, expect, it } from "vitest";
import { adx, atr, bollinger, crossedAbove, ema, lastCrossAbove, macd, relativeVolume, rsi, sma, vwap } from "../src/indicators/index.js";
import type { Candle } from "../src/domain/candles.js";

const close = (v: number[]) => v;
const bar = (t: number, o: number, h: number, l: number, c: number, vol = 1000): Candle => ({ time: t, open: o, high: h, low: l, close: c, volume: vol });

describe("moving averages", () => {
  it("SMA is the rolling mean and null during warm-up", () => {
    const r = sma([1, 2, 3, 4, 5], 3);
    expect(r).toEqual([null, null, 2, 3, 4]);
  });

  it("EMA seeds with the SMA and follows alpha = 2/(n+1)", () => {
    // EMA(3) of 1..10 with alpha 0.5 is a running average of the previous value and the new one.
    const r = ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
    expect(r[1]).toBeNull();
    expect(r[2]).toBeCloseTo(2, 10);
    expect(r[3]).toBeCloseTo(3, 10);
    expect(r[9]).toBeCloseTo(9, 10);
  });

  it("EMA returns all nulls when history is shorter than the period", () => {
    expect(ema([1, 2], 5).every((v) => v === null)).toBe(true);
  });
});

describe("momentum", () => {
  it("RSI is 100 for a strictly rising series and 50 for flat-then-equal moves", () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
    const last = rsi(rising, 14).at(-1);
    expect(last).toBe(100);
    const alternating = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    expect(rsi(alternating, 14).at(-1)!).toBeGreaterThan(45);
    expect(rsi(alternating, 14).at(-1)!).toBeLessThan(55);
  });

  it("RSI stays null before period + 1 closes", () => {
    const r = rsi([1, 2, 3, 4, 5], 14);
    expect(r.every((v) => v === null)).toBe(true);
  });

  it("MACD histogram equals line minus signal where both exist", () => {
    const series = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1);
    const m = macd(series);
    const i = 79;
    expect(m.histogram[i]).toBeCloseTo(m.macd[i]! - m.signal[i]!, 10);
    expect(m.signal[25]).toBeNull();
  });
});

describe("volatility and trend strength", () => {
  it("ATR of constant true range equals that range", () => {
    const candles = Array.from({ length: 30 }, (_, i) => bar(i * 60000, 100, 102, 100, 101));
    const a = atr(candles, 14);
    expect(a[14]).toBeCloseTo(2, 10);
    expect(a[29]).toBeCloseTo(2, 10);
  });

  it("ADX is high for a steady uptrend", () => {
    const candles = Array.from({ length: 80 }, (_, i) => bar(i * 60000, 100 + i, 101 + i, 99.5 + i, 100.8 + i));
    const r = adx(candles, 14);
    const last = r.adx.at(-1)!;
    expect(last).toBeGreaterThan(40);
    expect(r.plusDI.at(-1)!).toBeGreaterThan(r.minusDI.at(-1)!);
  });

  it("Bollinger bands are symmetric around the middle band", () => {
    const b = bollinger(Array.from({ length: 25 }, (_, i) => 100 + (i % 3)), 20, 2);
    expect(b.upper[19]! - b.mid[19]!).toBeCloseTo(b.mid[19]! - b.lower[19]!, 10);
  });
});

describe("volume", () => {
  it("relative volume compares with the previous completed candles only", () => {
    const v = [100, 100, 100, 100, 300];
    expect(relativeVolume(v, 4, 4)).toBeCloseTo(3, 10);
  });

  it("relative volume is null for an incomplete candle", () => {
    expect(relativeVolume([100, 100, 100, 100, 300], 4, 4, false)).toBeNull();
  });

  it("VWAP resets each IST trading day and ignores zero-volume periods", () => {
    const day1 = Date.UTC(2026, 0, 5, 3, 45); // 09:15 IST
    const day2 = day1 + 86_400_000;
    const candles = [bar(day1, 100, 100, 100, 100, 0), bar(day1 + 60000, 100, 102, 98, 100, 10), bar(day2, 200, 200, 200, 200, 10)];
    const v = vwap(candles);
    expect(v[0]).toBeNull();
    expect(v[1]).toBeCloseTo(100, 10);
    expect(v[2]).toBeCloseTo(200, 10);
  });
});

describe("crossovers", () => {
  it("detects a crossover from the previous-to-current bar transition", () => {
    const fast = [1, 2, 3, 4];
    const slow = [2, 2.5, 3, 3.5];
    expect(crossedAbove(fast, slow, 3)).toBe(true);
    expect(crossedAbove(fast, slow, 2)).toBe(false);
  });

  it("does not report a crossover while either side is null", () => {
    expect(crossedAbove([null, 5], [1, 1], 1)).toBe(false);
  });

  it("finds the most recent cross within a lookback window", () => {
    const fast = [1, 1, 3, 3, 3];
    const slow = [2, 2, 2, 2, 2];
    expect(lastCrossAbove(fast, slow, 4, 3)).toBe(2);
    expect(lastCrossAbove(fast, slow, 4, 1)).toBeNull();
  });

  it("is unaffected by later bars", () => {
    const base = [1, 1, 3];
    const slow = [2, 2, 2];
    expect(crossedAbove(base, slow, 2)).toBe(true);
    expect(close(base)).toEqual([1, 1, 3]);
  });
});
