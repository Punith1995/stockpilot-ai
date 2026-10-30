/**
 * Single-symbol backtest of the strategy on closed candles.
 *
 * Execution model (documented assumptions):
 *  - A signal is read from CLOSED bar j. The order fills at the OPEN of bar j+1, plus slippage against us.
 *  - If bar j+1 opens below the stop, the entry is skipped (the trade would be stopped immediately).
 *  - Within a bar, the stop is checked before the target (the conservative order when both are touched).
 *  - A gap through the stop fills at the open; a gap above the target fills at the open.
 *  - Exits by EMA cross-down are decided on bar j's close and filled at bar j+1's open.
 *  - Quantity is sized on current equity (compounding). Costs use src/domain/costs.ts.
 *  - Only one position per symbol at a time. Unrealized P&L is not part of the equity curve.
 */
import type { Candle } from "../domain/candles.js";
import { tradeCosts, type ProductType } from "../domain/costs.js";
import { istParts } from "../domain/candles.js";
import { computeSeries, emaCrossedDown, evaluateLong, planLong, round2, type StrategyConfig } from "../strategy/ema-momentum-pro.js";

export interface BacktestOptions {
  productType: ProductType;
  slippageBps: number; // 5 = 0.05 %
}

export interface TradeRecord {
  symbol: string;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  qty: number;
  initialStop: number;
  target: number;
  exitReason: "STOP" | "TARGET" | "EMA_CROSS_DOWN" | "MAX_HOLD" | "END_OF_DATA" | "TRAIL_STOP";
  grossPnl: number;
  costs: number;
  netPnl: number;
  riskAmount: number;
  rMultiple: number;
  barsHeld: number;
}

export interface EquityPoint { time: number; equity: number }

export interface SymbolRun {
  symbol: string;
  bars: number;
  signals: number;
  trades: TradeRecord[];
  equity: EquityPoint[];
  skipped: { time: number; reason: string }[];
}

interface OpenPosition {
  entryIdx: number; entryTime: number; entry: number; stop: number; initialStop: number; target: number;
  qty: number; riskAmount: number;
}

export function runBacktest(symbol: string, candles: Candle[], cfg: StrategyConfig, opts: BacktestOptions): SymbolRun {
  const S = computeSeries(candles, cfg);
  const slip = opts.slippageBps / 10_000;
  const n = candles.length;
  const trades: TradeRecord[] = [];
  const skipped: SymbolRun["skipped"] = [];
  const equityCurve: EquityPoint[] = n ? [{ time: candles[0].time, equity: cfg.capital }] : [];
  let equity = cfg.capital;
  let pos: OpenPosition | null = null;
  let pendingExit: TradeRecord["exitReason"] | null = null;
  let signals = 0;

  const close = (j: number, fill: number, reason: TradeRecord["exitReason"]) => {
    if (!pos) return;
    const buyValue = pos.entry * pos.qty;
    const sellValue = fill * pos.qty;
    const costs = tradeCosts(opts.productType, buyValue, sellValue);
    const gross = sellValue - buyValue;
    const net = gross - costs.total;
    equity += net;
    trades.push({
      symbol, entryTime: pos.entryTime, entryPrice: round2(pos.entry), exitTime: candles[j].time, exitPrice: round2(fill),
      qty: pos.qty, initialStop: pos.initialStop, target: pos.target, exitReason: reason,
      grossPnl: round2(gross), costs: costs.total, netPnl: round2(net), riskAmount: round2(pos.riskAmount),
      rMultiple: pos.riskAmount > 0 ? round2(net / pos.riskAmount) : 0, barsHeld: j - pos.entryIdx + 1,
    });
    equityCurve.push({ time: candles[j].time, equity: round2(equity) });
    pos = null;
  };

  for (let j = 0; j < n; j++) {
    const c = candles[j];
    if (pos) {
      const p: OpenPosition = pos;
      if (pendingExit) {
        close(j, c.open * (1 - slip), pendingExit);
        pendingExit = null;
      } else if (c.low <= p.stop) {
        close(j, Math.min(c.open, p.stop) * (1 - slip), p.stop > p.initialStop ? "TRAIL_STOP" : "STOP");
      } else if (c.high >= p.target) {
        close(j, Math.max(c.open, p.target) * (1 - slip), "TARGET");
      } else if (j - p.entryIdx + 1 >= cfg.maxHoldBars) {
        close(j, c.close * (1 - slip), "MAX_HOLD");
      } else {
        if (cfg.trailingAtrMultiple > 0 && S.atr[j] != null) {
          p.stop = Math.max(p.stop, round2(c.close - cfg.trailingAtrMultiple * S.atr[j]!));
        }
        if (emaCrossedDown(S, j)) pendingExit = "EMA_CROSS_DOWN";
      }
    }

    if (!pos && j + 1 < n) {
      const ev = evaluateLong(S, j, cfg, { complete: true });
      if (ev.signal === "BUY" && ev.plan) {
        signals++;
        const next = candles[j + 1];
        const fill = next.open * (1 + slip);
        if (next.open <= ev.plan.stop) {
          skipped.push({ time: next.time, reason: "opened below the stop — entry skipped" });
        } else {
          const sized = planLong(S, j, { ...cfg, capital: equity }, fill);
          if (sized.plan) {
            pos = {
              entryIdx: j + 1, entryTime: next.time, entry: fill, stop: sized.plan.stop, initialStop: sized.plan.stop,
              target: sized.plan.target, qty: sized.plan.qty, riskAmount: sized.plan.riskAmount,
            };
          } else {
            skipped.push({ time: next.time, reason: sized.reason ?? "invalid plan" });
          }
        }
      }
    }
  }
  if (pos && n) close(n - 1, candles[n - 1].close * (1 - slip), "END_OF_DATA");

  return { symbol, bars: n, signals, trades, equity: equityCurve, skipped };
}

/**
 * Splits candles into in-sample (earlier sessions) and out-of-sample (latest sessions) by IST day.
 * The out-of-sample run starts with fresh indicators, so its first sessions are a warm-up.
 */
export function splitByDay(candles: Candle[], oosFraction: number): { inSample: Candle[]; outOfSample: Candle[] } {
  const days = [...new Set(candles.map((c) => istParts(c.time).dayKey))].sort((a, b) => a - b);
  const cut = days[Math.floor(days.length * (1 - oosFraction))];
  if (cut === undefined) return { inSample: candles, outOfSample: [] };
  return {
    inSample: candles.filter((c) => istParts(c.time).dayKey < cut),
    outOfSample: candles.filter((c) => istParts(c.time).dayKey >= cut),
  };
}
