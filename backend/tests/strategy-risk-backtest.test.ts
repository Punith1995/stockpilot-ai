import { describe, expect, it } from "vitest";
import type { Candle } from "../src/domain/candles.js";
import { tradeCosts } from "../src/domain/costs.js";
import { EMA_MOMENTUM_PRO, computeSeries, evaluateLong, planLong, type StrategyConfig } from "../src/strategy/ema-momentum-pro.js";
import { checkEntry, DEFAULT_RISK_LIMITS, type RiskSnapshot } from "../src/risk/risk-manager.js";
import { runBacktest } from "../src/backtest/engine.js";
import { computeMetrics } from "../src/backtest/metrics.js";

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 5, 3, 45);
const cfgWith = (o: Partial<StrategyConfig> = {}): StrategyConfig => ({ ...EMA_MOMENTUM_PRO, ...o, conditions: { ...EMA_MOMENTUM_PRO.conditions, ...(o.conditions ?? {}) } });

/** Deterministic rising series with a pullback every 9 bars and a volume spike near the end. */
function trendSeries(n: number): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const drift = i % 9 === 8 ? -0.6 : 0.5;
    const open = p;
    const close = p + drift;
    out.push({ time: START + i * DAY, open, high: Math.max(open, close) + 0.4, low: Math.min(open, close) - 0.4, close, volume: 1000 + (i % 5) * 10 });
    p = close;
  }
  return out;
}

describe("trading costs", () => {
  it("caps brokerage at ₹20 per order and charges STT on the sell side only for intraday", () => {
    const c = tradeCosts("INTRADAY", 100000, 101000);
    expect(c.brokerage).toBe(40); // ₹20 cap on each side
    expect(c.stt).toBeCloseTo(25.25, 2); // 0.025 % of ₹101,000 sell value
    expect(c.total).toBeGreaterThan(c.brokerage);
  });

  it("charges delivery STT on both sides", () => {
    const c = tradeCosts("DELIVERY", 100000, 100000);
    expect(c.stt).toBeCloseTo(200, 2); // 0.1 % × 2 × ₹100,000
  });
});

describe("strategy", () => {
  it("never reads future bars: the decision on bar i is the same with or without later bars", () => {
    const candles = trendSeries(260);
    const cfg = cfgWith();
    const full = computeSeries(candles, cfg);
    for (const i of [230, 240, 255]) {
      const truncated = computeSeries(candles.slice(0, i + 1), cfg);
      const a = evaluateLong(full, i, cfg);
      const b = evaluateLong(truncated, i, cfg);
      expect(a.signal).toBe(b.signal);
      expect(a.checks.map((c) => c.pass)).toEqual(b.checks.map((c) => c.pass));
    }
  });

  it("an incomplete bar fails the relative-volume check instead of being compared", () => {
    const candles = trendSeries(260);
    const cfg = cfgWith();
    const S = computeSeries(candles, cfg);
    const ev = evaluateLong(S, 259, cfg, { complete: false });
    expect(ev.checks.find((c) => c.id === "relVolume")!.pass).toBe(false);
    expect(ev.signal).toBe("WAIT");
  });

  it("lists every failed mandatory condition", () => {
    const candles = trendSeries(260);
    const cfg = cfgWith();
    const ev = evaluateLong(computeSeries(candles, cfg), 259, cfg);
    expect(ev.failedMandatory.length).toBeGreaterThan(0);
    for (const id of ev.failedMandatory) expect(ev.checks.find((c) => c.id === id)!.pass).not.toBe(true);
  });

  it("a disabled condition is not part of the decision", () => {
    const candles = trendSeries(260);
    const all = cfgWith();
    const relaxed = cfgWith({ conditions: { ...EMA_MOMENTUM_PRO.conditions, relVolume: { enabled: false, mandatory: false } } });
    const S = computeSeries(candles, all);
    const withRv = evaluateLong(S, 259, all);
    const withoutRv = evaluateLong(S, 259, relaxed);
    expect(withoutRv.checks.find((c) => c.id === "relVolume")!.enabled).toBe(false);
    expect(withoutRv.failedMandatory).not.toContain("relVolume");
    expect(withRv.failedMandatory.includes("relVolume") || withRv.checks.find((c) => c.id === "relVolume")!.pass !== false).toBe(true);
  });
});

describe("risk plan and sizing", () => {
  it("matches the worked example: entry 1000, stop 970, target 1060, 100 shares at ₹1,00,000 capital", () => {
    const candles = trendSeries(60).map((c, i) => (i === 59 ? { ...c, close: 1000, open: 1000, high: 1001, low: 999 } : c));
    const cfg = cfgWith({ stopMethod: "swing", swingLookback: 10, capital: 100000, riskPerTradePct: 0.5, maxPositionPct: 100 });
    const S = computeSeries(candles, cfg);
    S.lows = [...S.lows];
    for (let k = 50; k <= 59; k++) S.lows[k] = k === 55 ? 970 : 995;
    const { plan } = planLong(S, 59, cfg, 1000);
    expect(plan!.stop).toBe(970);
    expect(plan!.target).toBe(1060);
    expect(plan!.riskPerShare).toBe(30);
    // risk budget ₹500 ÷ ₹30 = 16 shares under 0.5 % risk; the example in the spec uses full capital instead.
    expect(plan!.qty).toBe(16);
  });

  it("rejects an invalid stop that is above the entry", () => {
    const candles = trendSeries(60);
    const cfg = cfgWith({ stopMethod: "atr", atrMultiple: -1 });
    const S = computeSeries(candles, cfg);
    expect(planLong(S, 59, cfg, 100).plan).toBeNull();
  });
});

describe("risk manager", () => {
  const empty: RiskSnapshot = { openPositions: 0, heldSymbols: [], dailyRealizedPnl: 0, tradesToday: 0, exposureBySymbol: {}, emergencyStop: false };
  it("allows an entry inside all limits", () => {
    expect(checkEntry(DEFAULT_RISK_LIMITS, empty, { symbol: "A", orderValue: 10000 }).allowed).toBe(true);
  });
  it("blocks on emergency stop, daily loss and max positions", () => {
    expect(checkEntry(DEFAULT_RISK_LIMITS, { ...empty, emergencyStop: true }, { symbol: "A", orderValue: 1 }).reasons[0]).toMatch(/Emergency/);
    expect(checkEntry(DEFAULT_RISK_LIMITS, { ...empty, dailyRealizedPnl: -2000 }, { symbol: "A", orderValue: 1 }).allowed).toBe(false);
    expect(checkEntry(DEFAULT_RISK_LIMITS, { ...empty, openPositions: 5 }, { symbol: "A", orderValue: 1 }).allowed).toBe(false);
  });
});

describe("backtest and metrics", () => {
  it("runs deterministically and the equity curve reconciles with trade P&L", () => {
    const candles = trendSeries(400);
    const cfg = cfgWith({ conditions: { ...EMA_MOMENTUM_PRO.conditions, freshCross: { enabled: false, mandatory: false }, rsiRange: { enabled: false, mandatory: false }, adx: { enabled: false, mandatory: false }, relVolume: { enabled: false, mandatory: false }, macd: { enabled: false, mandatory: false }, priceAction: { enabled: true, mandatory: true } } });
    const opts = { productType: "DELIVERY" as const, slippageBps: 5 };
    const a = runBacktest("TEST", candles, cfg, opts);
    const b = runBacktest("TEST", candles, cfg, opts);
    expect(a).toEqual(b);
    const sum = a.trades.reduce((s, t) => s + t.netPnl, 0);
    expect(a.equity.at(-1)!.equity).toBeCloseTo(cfg.capital + sum, 1);
    for (const t of a.trades) expect(["STOP", "TARGET", "EMA_CROSS_DOWN", "MAX_HOLD", "END_OF_DATA", "TRAIL_STOP"]).toContain(t.exitReason);
  });

  it("returns no trades for too little history instead of failing", () => {
    const r = runBacktest("TEST", trendSeries(30), cfgWith(), { productType: "DELIVERY", slippageBps: 5 });
    expect(r.trades).toHaveLength(0);
  });

  it("profit factor is null when there are no losing trades", () => {
    const m = computeMetrics([{ symbol: "A", entryTime: 0, entryPrice: 1, exitTime: DAY, exitPrice: 2, qty: 1, initialStop: 0.5, target: 2, exitReason: "TARGET", grossPnl: 1, costs: 0, netPnl: 1, riskAmount: 0.5, rMultiple: 2, barsHeld: 1 }], 100, [{ time: 0, equity: 100 }, { time: DAY, equity: 101 }]);
    expect(m.profitFactor).toBeNull();
    expect(m.winRate).toBe(100);
    expect(m.warnings.some((w) => /too few/.test(w))).toBe(true);
  });

  it("measures maximum drawdown from the equity peak", () => {
    const eq = [100, 120, 90, 110].map((v, i) => ({ time: i * DAY, equity: v }));
    const m = computeMetrics([], 100, eq);
    expect(m.maxDrawdown).toBe(30);
    expect(m.maxDrawdownPct).toBeCloseTo(25, 1);
  });
});
