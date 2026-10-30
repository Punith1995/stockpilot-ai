import { describe, expect, it } from "vitest";
import { aggregate, isInSession, sanitizeCandles, type Candle } from "../src/domain/candles.js";

// 2026-01-05 is a Monday. 09:15 IST = 03:45 UTC.
const MON_0915 = Date.UTC(2026, 0, 5, 3, 45);
const minute = (i: number, o = 100, vol = 10): Candle => ({ time: MON_0915 + i * 60_000, open: o, high: o + 1, low: o - 1, close: o + 0.5, volume: vol });

describe("sanitizeCandles", () => {
  it("drops invalid rows and reports why", () => {
    const r = sanitizeCandles([minute(0), { ...minute(1), high: 90 }, { ...minute(2), volume: -5 }]);
    expect(r.candles).toHaveLength(1);
    expect(r.dropped.map((d) => d.reason)).toEqual(["high below low", "negative volume"]);
  });

  it("sorts and removes duplicate timestamps, keeping the last", () => {
    const r = sanitizeCandles([minute(2), minute(0), { ...minute(0), close: 100.9 }]);
    expect(r.candles.map((c) => c.time)).toEqual([MON_0915, MON_0915 + 120_000]);
    expect(r.candles[0].close).toBe(100.9);
    expect(r.duplicates).toBe(1);
  });
});

describe("session boundaries", () => {
  it("accepts 09:15 and rejects 15:30 and pre-open candles", () => {
    expect(isInSession(MON_0915)).toBe(true);
    expect(isInSession(Date.UTC(2026, 0, 5, 10, 0))).toBe(false); // 15:30 IST
    expect(isInSession(Date.UTC(2026, 0, 5, 2, 0))).toBe(false); // 07:30 IST
  });

  it("rejects weekends", () => {
    expect(isInSession(Date.UTC(2026, 0, 3, 3, 45))).toBe(false); // Saturday 09:15 IST
  });
});

describe("aggregate", () => {
  it("merges 5 one-minute candles into one complete 5-minute candle and sums volume once", () => {
    const base = [0, 1, 2, 3, 4].map((i) => minute(i, 100 + i, 10));
    const [c] = aggregate(base, 1, 5);
    expect(c.time).toBe(MON_0915);
    expect(c.open).toBe(100);
    expect(c.close).toBe(104.5);
    expect(c.high).toBe(105);
    expect(c.low).toBe(99);
    expect(c.volume).toBe(50);
    expect(c.complete).toBe(true);
  });

  it("marks a partial bucket as incomplete instead of presenting it as complete", () => {
    const [c] = aggregate([minute(0), minute(1)], 1, 5);
    expect(c.complete).toBe(false);
    expect(c.count).toBe(2);
  });

  it("never merges candles across two trading days", () => {
    const nextDay = Date.UTC(2026, 0, 6, 3, 45);
    const out = aggregate([minute(4), { ...minute(0), time: nextDay }], 1, 5);
    expect(out).toHaveLength(2);
  });

  it("refuses an interval that is not a multiple of the base interval", () => {
    expect(() => aggregate([minute(0)], 5, 7)).toThrow();
  });
});
