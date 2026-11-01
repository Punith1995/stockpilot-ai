/**
 * Backtest for any SimpleStrategy. Same execution rules as the EMA engine:
 * signal on closed bar j → fill at bar j+1 open plus slippage; stop checked before target;
 * discretionary exits use NEXT_OPEN or NOW as the strategy requests; costs via tradeCosts.
 */
import type { Candle } from "../domain/candles.js";
import { tradeCosts } from "../domain/costs.js";
import type { SimpleStrategy } from "../strategies/library.js";
import type { TradeRecord, EquityPoint } from "./engine.js";

export interface GenericRun { trades: TradeRecord[]; equity: EquityPoint[]; signals: number; skipped: number }

export function runGeneric(symbol: string, candles: Candle[], s: SimpleStrategy, opts: { capital: number; riskPerTradePct: number; maxPositionPct: number; slippageBps: number }): GenericRun {
  const p = s.prepare(candles);
  const slip = opts.slippageBps / 10_000;
  const n = candles.length;
  const trades: TradeRecord[] = [];
  const equity: EquityPoint[] = n ? [{ time: candles[0].time, equity: opts.capital }] : [];
  let cash = opts.capital;
  let signals = 0, skipped = 0;
  type Pos = { entryIdx: number; entryTime: number; entry: number; stop: number; initialStop: number; target: number; qty: number; riskAmount: number };
  let pos: Pos | null = null;
  let pendingExit = false;

  const close = (j: number, fill: number, reason: TradeRecord["exitReason"]) => {
    if (!pos) return;
    const buyValue = pos.entry * pos.qty, sellValue = fill * pos.qty;
    const costs = tradeCosts(s.product, buyValue, sellValue);
    const gross = sellValue - buyValue, net = gross - costs.total;
    cash += sellValue - costs.total;
    trades.push({
      symbol, entryTime: pos.entryTime, entryPrice: round(pos.entry), exitTime: candles[j].time, exitPrice: round(fill),
      qty: pos.qty, initialStop: pos.initialStop, target: pos.target, exitReason: reason,
      grossPnl: round(gross), costs: costs.total, netPnl: round(net), riskAmount: round(pos.riskAmount),
      rMultiple: pos.riskAmount > 0 ? round(net / pos.riskAmount) : 0, barsHeld: j - pos.entryIdx + 1,
    });
    equity.push({ time: candles[j].time, equity: round(cash) });
    pos = null;
  };

  for (let j = 0; j < n; j++) {
    const c = candles[j];
    if (pos) {
      const q: Pos = pos;
      if (pendingExit) { pendingExit = false; close(j, c.open * (1 - slip), "STRATEGY_EXIT"); }
      else if (c.low <= q.stop) close(j, Math.min(c.open, q.stop) * (1 - slip), "STOP");
      else if (c.high >= q.target) close(j, Math.max(c.open, q.target) * (1 - slip), "TARGET");
      else if (j - q.entryIdx + 1 >= s.maxHoldBars) close(j, c.close * (1 - slip), "MAX_HOLD");
      else {
        const x = s.exit(p, j);
        if (x === "NOW") close(j, c.close * (1 - slip), "STRATEGY_EXIT");
        else if (x === "NEXT_OPEN") pendingExit = true;
      }
    }

    if (!pos && j + 1 < n && s.buy(p, j)) {
      signals++;
      const next = candles[j + 1];
      const fill = next.open * (1 + slip);
      const stop = s.stop(p, j, fill);
      if (stop == null || !(stop < fill) || next.open <= stop) { skipped++; continue; }
      const riskPerShare = fill - stop;
      const budget = (cash * opts.riskPerTradePct) / 100;
      const qty = Math.floor(Math.min(budget / riskPerShare, (cash * opts.maxPositionPct) / 100 / fill));
      if (qty < 1 || qty * fill > cash) { skipped++; continue; }
      const target = fill + s.targetR * riskPerShare;
      pos = { entryIdx: j + 1, entryTime: next.time, entry: fill, stop, initialStop: stop, target, qty, riskAmount: riskPerShare * qty };
      cash -= fill * qty;
    }
  }
  if (pos && n) close(n - 1, candles[n - 1].close * (1 - slip), "END_OF_DATA");
  return { trades, equity, signals, skipped };
}

const round = (v: number) => Math.round(v * 100) / 100;
