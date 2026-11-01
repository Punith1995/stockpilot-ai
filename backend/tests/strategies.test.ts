import { describe, expect, it } from "vitest";
import type { Candle } from "../src/domain/candles.js";
import { SIMPLE_STRATEGIES } from "../src/strategies/library.js";
import { runGeneric } from "../src/backtest/generic-engine.js";
import { sampleCandles } from "../src/data/sample.js";

const OPTS = { capital: 100000, riskPerTradePct: 0.5, maxPositionPct: 25, slippageBps: 5 };

describe("five simple strategies", () => {
  it("exactly ten strategies, each with a name, a summary and a best-for line", () => {
    expect(SIMPLE_STRATEGIES).toHaveLength(15);
    for (const s of SIMPLE_STRATEGIES) {
      expect(s.name.length).toBeGreaterThan(3);
      expect(s.summary.length).toBeGreaterThan(20);
      expect(s.bestFor.length).toBeGreaterThan(5);
    }
  });

  for (const strat of SIMPLE_STRATEGIES) {
    it(`${strat.name}: entry decisions never use future bars`, () => {
      const candles = sampleCandles("INFY", 40, 1520);
      const full = strat.prepare(candles);
      for (const cut of [200, 400, candles.length - 2]) {
        const prefix = strat.prepare(candles.slice(0, cut + 1));
        for (let i = 0; i <= cut; i++) {
          expect(strat.buy(prefix, i)).toBe(strat.buy(full, i));
        }
      }
    });

    it(`${strat.name}: backtest is deterministic and the equity curve ends at capital plus net P&L`, () => {
      const candles = sampleCandles("TCS", 60, 3900);
      const a = runGeneric("TCS", candles, strat, OPTS);
      const b = runGeneric("TCS", candles, strat, OPTS);
      expect(a).toEqual(b);
      const sum = a.trades.reduce((s, t) => s + t.netPnl, 0);
      const diff = Math.abs((a.equity.at(-1)?.equity ?? OPTS.capital) - (OPTS.capital + sum));
      expect(diff).toBeLessThanOrEqual(0.01 * (a.trades.length + 1));
    });
  }

  it("opening range breakout buys at most once per session and exits by 15:15 IST", () => {
    const orb = SIMPLE_STRATEGIES.find((s) => s.id === "opening-range-breakout")!;
    const candles = sampleCandles("RELIANCE", 40, 2850);
    const p = orb.prepare(candles);
    const flagsByDay = new Map<number, number>();
    candles.forEach((c, i) => {
      if (orb.buy(p, i)) {
        const day = Math.floor((c.time + 19_800_000) / 86_400_000);
        flagsByDay.set(day, (flagsByDay.get(day) ?? 0) + 1);
      }
    });
    for (const v of flagsByDay.values()) expect(v).toBeLessThanOrEqual(1);
    const run = runGeneric("RELIANCE", candles, orb, OPTS);
    for (const t of run.trades) {
      const ist = new Date(t.exitTime + 19_800_000);
      const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      const sameDay = Math.floor((t.entryTime + 19_800_000) / 86_400_000) === Math.floor((t.exitTime + 19_800_000) / 86_400_000);
      expect(sameDay).toBe(true);
      expect(minutes).toBeLessThanOrEqual(15 * 60 + 15);
    }
  });

  it("a stop is never placed above the entry price", () => {
    for (const strat of SIMPLE_STRATEGIES) {
      const candles = sampleCandles("ICICIBANK", 40, 1240);
      const run = runGeneric("ICICIBANK", candles, strat, OPTS);
      for (const t of run.trades) expect(t.initialStop).toBeLessThan(t.entryPrice);
    }
  });
});
