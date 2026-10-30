/**
 * In-memory paper trading. Nothing here places a real order.
 * Flow: a BUY signal on the last CLOSED bar creates a PENDING order; it fills at the open of the
 * next bar seen by onBar(). Duplicate signals (same symbol + same signal bar) are ignored.
 * Stops and targets are checked on each bar; stop first when both are touched.
 */
import type { Candle } from "../domain/candles.js";
import { tradeCosts } from "../domain/costs.js";
import { checkEntry, DEFAULT_RISK_LIMITS, type RiskLimits } from "../risk/risk-manager.js";
import { computeSeries, evaluateLong, round2, type RiskPlan, type StrategyConfig } from "../strategy/ema-momentum-pro.js";
import { istParts } from "../domain/candles.js";

export interface PaperOrder { id: string; symbol: string; signalTime: number; status: "PENDING" | "FILLED" | "REJECTED"; plan: RiskPlan; fillTime?: number; fillPrice?: number; reason?: string }
export interface PaperPosition { symbol: string; qty: number; entry: number; stop: number; target: number; entryTime: number; initialStop: number; riskAmount: number; barsHeld: number }
export interface PaperTrade { symbol: string; qty: number; entry: number; exit: number; entryTime: number; exitTime: number; reason: string; netPnl: number; costs: number }

export class PaperEngine {
  readonly mode = "PAPER" as const;
  cash: number;
  readonly startCapital: number;
  positions = new Map<string, PaperPosition>();
  orders: PaperOrder[] = [];
  trades: PaperTrade[] = [];
  emergencyStop = false;
  private seenSignals = new Set<string>();
  private nextId = 1;
  private readonly maxRecords = 500;

  constructor(private limits: RiskLimits = DEFAULT_RISK_LIMITS, private cfg: StrategyConfig) {
    this.startCapital = limits.capital;
    this.cash = limits.capital;
  }

  get realizedPnl(): number { return this.trades.reduce((s, t) => s + t.netPnl, 0); }

  private todayKey(ms: number): number { return istParts(ms).dayKey; }

  private tradesToday(now: number): number {
    const k = this.todayKey(now);
    return this.orders.filter((o) => o.status === "FILLED" && this.todayKey(o.fillTime!) === k).length;
  }

  private dailyPnl(now: number): number {
    const k = this.todayKey(now);
    return this.trades.filter((t) => this.todayKey(t.exitTime) === k).reduce((s, t) => s + t.netPnl, 0);
  }

  /** Evaluate the latest closed bar and queue an order if all rules pass. Idempotent per signal bar. */
  submitSignal(symbol: string, candles: Candle[], complete = true): { status: "QUEUED" | "NO_SIGNAL" | "DUPLICATE" | "BLOCKED"; reasons?: string[]; order?: PaperOrder; evaluation?: ReturnType<typeof evaluateLong> } {
    if (candles.length < 2) return { status: "NO_SIGNAL", reasons: ["not enough bars"] };
    const i = candles.length - 1;
    const S = computeSeries(candles, this.cfg);
    const ev = evaluateLong(S, i, this.cfg, { complete });
    if (ev.signal !== "BUY" || !ev.plan) return { status: "NO_SIGNAL", evaluation: ev };
    const key = `${symbol}:${candles[i].time}`;
    if (this.seenSignals.has(key)) return { status: "DUPLICATE", evaluation: ev };
    this.seenSignals.add(key);
    const now = candles[i].time;
    const entryEstimate = candles[i].close;
    const orderValue = entryEstimate * ev.plan.qty;
    const risk = checkEntry(this.limits, {
      openPositions: this.positions.size,
      heldSymbols: [...this.positions.keys()],
      dailyRealizedPnl: this.dailyPnl(now),
      tradesToday: this.tradesToday(now),
      exposureBySymbol: Object.fromEntries([...this.positions.values()].map((p) => [p.symbol, p.qty * p.entry])),
      emergencyStop: this.emergencyStop,
    }, { symbol, orderValue });
    if (!risk.allowed) return { status: "BLOCKED", reasons: risk.reasons, evaluation: ev };
    const order: PaperOrder = { id: `P${this.nextId++}`, symbol, signalTime: now, status: "PENDING", plan: ev.plan };
    this.orders.push(order);
    this.trim();
    return { status: "QUEUED", order, evaluation: ev };
  }

  /** Process a new bar for a symbol: fill pending orders at this bar's open, then manage exits. */
  onBar(symbol: string, candles: Candle[]): void {
    if (!candles.length) return;
    const last = candles[candles.length - 1];
    for (const o of this.orders) {
      if (o.status !== "PENDING" || o.symbol !== symbol || last.time <= o.signalTime) continue;
      if (this.positions.has(symbol)) { o.status = "REJECTED"; o.reason = "already holding"; continue; }
      if (last.open <= o.plan.stop) { o.status = "REJECTED"; o.reason = "opened below stop"; continue; }
      const cost = last.open * o.plan.qty;
      if (cost > this.cash) { o.status = "REJECTED"; o.reason = "insufficient paper cash"; continue; }
      o.status = "FILLED"; o.fillTime = last.time; o.fillPrice = round2(last.open);
      this.cash -= cost;
      this.positions.set(symbol, { symbol, qty: o.plan.qty, entry: last.open, stop: o.plan.stop, initialStop: o.plan.stop, target: o.plan.target, entryTime: last.time, riskAmount: o.plan.riskAmount, barsHeld: 0 });
    }
    const pos = this.positions.get(symbol);
    if (!pos) return;
    if (last.time === pos.entryTime) return;
    pos.barsHeld++;
    if (last.low <= pos.stop) return this.close(symbol, Math.min(last.open, pos.stop), last.time, "STOP");
    if (last.high >= pos.target) return this.close(symbol, Math.max(last.open, pos.target), last.time, "TARGET");
    if (pos.barsHeld >= this.cfg.maxHoldBars) return this.close(symbol, last.close, last.time, "MAX_HOLD");
  }

  close(symbol: string, price: number, time: number, reason: string): void {
    const pos = this.positions.get(symbol);
    if (!pos) return;
    const costs = tradeCosts("DELIVERY", pos.entry * pos.qty, price * pos.qty);
    const netPnl = round2(price * pos.qty - pos.entry * pos.qty - costs.total);
    this.cash += price * pos.qty - costs.total;
    this.trades.push({ symbol, qty: pos.qty, entry: round2(pos.entry), exit: round2(price), entryTime: pos.entryTime, exitTime: time, reason, netPnl, costs: round2(costs.total) });
    this.positions.delete(symbol);
    this.trim();
  }

  /** Manual exit of all paper positions. Used by the emergency stop. */
  flatten(now: number, prices: Map<string, number>): number {
    let n = 0;
    for (const sym of [...this.positions.keys()]) {
      this.close(sym, prices.get(sym) ?? this.positions.get(sym)!.entry, now, "EMERGENCY_FLATTEN");
      n++;
    }
    return n;
  }

  snapshot() {
    return {
      mode: this.mode,
      startCapital: this.startCapital,
      cash: round2(this.cash),
      realizedPnl: round2(this.realizedPnl),
      emergencyStop: this.emergencyStop,
      positions: [...this.positions.values()],
      orders: this.orders.slice(-50),
      trades: this.trades.slice(-100),
    };
  }

  private trim(): void {
    if (this.orders.length > this.maxRecords) this.orders.splice(0, this.orders.length - this.maxRecords);
    if (this.trades.length > this.maxRecords) this.trades.splice(0, this.trades.length - this.maxRecords);
    if (this.seenSignals.size > 10 * this.maxRecords) this.seenSignals = new Set([...this.seenSignals].slice(-5 * this.maxRecords));
  }
}

