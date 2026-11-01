/**
 * StockPilot EMA Momentum Pro — a starting hypothesis to be tested, NOT a proven system.
 *
 * Long entry, evaluated on a CLOSED candle i only (no future bars are read):
 *   1 fresh EMA-fast/slow upward cross within the lookback (or a continuation setup)
 *   2 close above the trend EMA (200)
 *   3 slow EMA rising over the slope lookback
 *   4 RSI within [min, max]
 *   5 MACD line above its signal line
 *   6 relative volume >= threshold (completed bars only)
 *   7 ADX above threshold
 *   8 price action: breakout above recent highs and/or pullback to the fast EMA that bounces
 *   9 enough history (always mandatory)
 *  10 valid risk plan: stop below entry, quantity >= 1 (always mandatory)
 * Each condition can be enabled/disabled and set mandatory or optional in the config.
 */
import type { Candle } from "../domain/candles.js";
import { adx, atr, ema, highest, lowest, macd, relativeVolume, rsi, crossedBelow, lastCrossAbove, type Series } from "../indicators/index.js";

export const CONDITION_IDS = [
  "freshCross", "trendFilter", "emaSlope", "rsiRange", "macd", "relVolume", "adx", "priceAction", "dataSufficiency", "riskPlan",
] as const;
export type ConditionId = (typeof CONDITION_IDS)[number];

export const CONDITION_LABELS: Record<ConditionId, string> = {
  freshCross: "Fresh EMA fast/slow crossover",
  trendFilter: "Price above trend EMA",
  emaSlope: "Slow EMA rising",
  rsiRange: "RSI within range",
  macd: "MACD above signal",
  relVolume: "Relative volume",
  adx: "ADX trend strength",
  priceAction: "Breakout or pullback confirmation",
  dataSufficiency: "Enough valid history",
  riskPlan: "Valid risk plan",
};

export interface ConditionSetting { enabled: boolean; mandatory: boolean }

export interface StrategyConfig {
  name: string;
  fastEma: number;
  slowEma: number;
  trendEma: number;
  crossLookback: number;
  allowContinuation: boolean;
  slopeLookback: number;
  rsiPeriod: number;
  rsiMin: number;
  rsiMax: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  volumePeriod: number;
  minRelativeVolume: number;
  adxPeriod: number;
  minAdx: number;
  setup: "breakout" | "pullback" | "either";
  breakoutLookback: number;
  pullbackTolerancePct: number;
  stopMethod: "atr" | "swing";
  atrPeriod: number;
  atrMultiple: number;
  swingLookback: number;
  targetR: number;
  trailingAtrMultiple: number; // 0 = no trailing stop
  maxHoldBars: number;
  capital: number;
  riskPerTradePct: number;
  maxPositionPct: number;
  lotSize: number;
  conditions: Record<ConditionId, ConditionSetting>;
  /** Optional AND/OR groups. Each group must pass; members are removed from the flat mandatory/optional rules. */
  groups?: ConditionGroup[];
}

export interface ConditionGroup { id: string; op: "AND" | "OR"; members: ConditionId[] }

export const EMA_MOMENTUM_PRO: StrategyConfig = {
  name: "StockPilot EMA Momentum Pro",
  fastEma: 20, slowEma: 50, trendEma: 200,
  crossLookback: 3, allowContinuation: false, slopeLookback: 5,
  rsiPeriod: 14, rsiMin: 55, rsiMax: 70,
  macdFast: 12, macdSlow: 26, macdSignal: 9,
  volumePeriod: 20, minRelativeVolume: 1.5,
  adxPeriod: 14, minAdx: 20,
  setup: "either", breakoutLookback: 20, pullbackTolerancePct: 0.5,
  stopMethod: "atr", atrPeriod: 14, atrMultiple: 1.5, swingLookback: 10,
  targetR: 2, trailingAtrMultiple: 0, maxHoldBars: 20,
  capital: 100000, riskPerTradePct: 0.5, maxPositionPct: 25, lotSize: 1,
  conditions: Object.fromEntries(CONDITION_IDS.map((id) => [id, { enabled: true, mandatory: true }])) as Record<ConditionId, ConditionSetting>,
};

/** Precomputed indicator arrays for one candle set. */
export interface SeriesBundle {
  candles: Candle[];
  close: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  fast: Series;
  slow: Series;
  trend: Series;
  rsi: Series;
  macd: Series;
  macdSignal: Series;
  adx: Series;
  atr: Series;
  warmup: number;
}

export function computeSeries(candles: Candle[], cfg: StrategyConfig): SeriesBundle {
  const close = candles.map((c) => c.close);
  const m = macd(close, cfg.macdFast, cfg.macdSlow, cfg.macdSignal);
  const warmup = Math.max(cfg.trendEma, cfg.macdSlow + cfg.macdSignal, 2 * cfg.adxPeriod, cfg.rsiPeriod + 1, cfg.volumePeriod, cfg.atrPeriod, cfg.breakoutLookback + 2) + cfg.slopeLookback;
  return {
    candles, close,
    highs: candles.map((c) => c.high),
    lows: candles.map((c) => c.low),
    volumes: candles.map((c) => c.volume),
    fast: ema(close, cfg.fastEma),
    slow: ema(close, cfg.slowEma),
    trend: ema(close, cfg.trendEma),
    rsi: rsi(close, cfg.rsiPeriod),
    macd: m.macd,
    macdSignal: m.signal,
    adx: adx(candles, cfg.adxPeriod).adx,
    atr: atr(candles, cfg.atrPeriod),
    warmup,
  };
}

export interface RiskPlan {
  entry: number;
  stop: number;
  target: number;
  riskPerShare: number;
  qty: number;
  positionValue: number;
  riskAmount: number;
  rewardToRisk: number;
}

/** Stop, target and size for a long entry at `entryPrice` decided on closed bar i. */
export function planLong(S: SeriesBundle, i: number, cfg: StrategyConfig, entryPrice: number): { plan: RiskPlan | null; reason?: string } {
  let stop: number | null = null;
  if (cfg.stopMethod === "atr") {
    const a = S.atr[i];
    if (a == null) return { plan: null, reason: "ATR not ready" };
    stop = entryPrice - cfg.atrMultiple * a;
  } else {
    const low = lowest(S.lows, i - cfg.swingLookback + 1, i);
    if (low == null) return { plan: null, reason: "not enough bars for a swing low" };
    stop = low;
  }
  const riskPerShare = entryPrice - stop;
  if (!(riskPerShare > 0)) return { plan: null, reason: "stop is not below the entry" };
  const byRisk = Math.floor((cfg.capital * cfg.riskPerTradePct / 100) / riskPerShare);
  const byCap = Math.floor((cfg.capital * cfg.maxPositionPct / 100) / entryPrice);
  let qty = Math.min(byRisk, byCap);
  qty = Math.floor(qty / cfg.lotSize) * cfg.lotSize;
  if (qty < 1) return { plan: null, reason: "quantity rounds to zero for this risk budget" };
  return {
    plan: {
      entry: entryPrice,
      stop: round2(stop),
      target: round2(entryPrice + cfg.targetR * riskPerShare),
      riskPerShare: round2(riskPerShare),
      qty,
      positionValue: round2(qty * entryPrice),
      riskAmount: round2(qty * riskPerShare),
      rewardToRisk: cfg.targetR,
    },
  };
}

export interface CheckResult { id: ConditionId; label: string; enabled: boolean; mandatory: boolean; pass: boolean | null; detail: string }
export interface GroupResult { id: string; op: "AND" | "OR"; members: ConditionId[]; pass: boolean }
export interface Evaluation { index: number; time: number; signal: "BUY" | "WAIT"; checks: CheckResult[]; failedMandatory: string[]; groups: GroupResult[]; plan: RiskPlan | null; planReason?: string }

/** Conditions that cannot be placed in a group: they always apply. */
export const ALWAYS_MANDATORY: ConditionId[] = ["dataSufficiency", "riskPlan"];

/**
 * Evaluates the long setup on closed bar i. `complete` says whether bar i is a finished
 * candle; an incomplete bar fails the relative-volume check rather than being compared.
 */
export function evaluateLong(S: SeriesBundle, i: number, cfg: StrategyConfig, opts: { complete?: boolean } = {}): Evaluation {
  const complete = opts.complete ?? true;
  const c = S.candles[i];
  const ready = i >= S.warmup && i >= 1 && S.fast[i] != null && S.slow[i] != null && S.trend[i] != null && S.rsi[i] != null &&
    S.macd[i] != null && S.macdSignal[i] != null && S.adx[i] != null && S.atr[i] != null;
  const f = S.fast[i] ?? NaN, s = S.slow[i] ?? NaN, t = S.trend[i] ?? NaN;
  const slopeFrom = i - cfg.slopeLookback;
  const slowRising = slopeFrom >= 0 && S.slow[slopeFrom] != null && S.slow[i] != null && S.slow[i]! > S.slow[slopeFrom]!;
  const crossIdx = ready ? lastCrossAbove(S.fast, S.slow, i, cfg.crossLookback) : null;
  const continuation = f > s && c.close > f && slowRising;
  const freshPass = crossIdx != null || (cfg.allowContinuation && continuation);

  // price action
  const prior = (from: number, to: number) => highest(S.highs, from, to);
  const resistance = i - cfg.breakoutLookback >= 0 ? prior(i - cfg.breakoutLookback, i - 1) : null;
  const prevResistance = i - 1 - cfg.breakoutLookback >= 0 ? prior(i - 1 - cfg.breakoutLookback, i - 2) : null;
  const breakout = resistance != null && c.close > resistance && (prevResistance == null || S.candles[i - 1].close <= prevResistance);
  const pullback = f > s && c.low <= f * (1 + cfg.pullbackTolerancePct / 100) && c.close > f;
  const priceActionPass = cfg.setup === "breakout" ? breakout : cfg.setup === "pullback" ? pullback : breakout || pullback;

  const rv = relativeVolume(S.volumes, i, cfg.volumePeriod, complete);
  const plan = ready ? planLong(S, i, cfg, c.close) : { plan: null, reason: "not ready" };

  const raw: Record<ConditionId, { pass: boolean | null; detail: string }> = {
    freshCross: { pass: ready ? freshPass : null, detail: crossIdx != null ? `cross ${i - crossIdx} bar(s) ago` : continuation ? "continuation setup" : `no cross in last ${cfg.crossLookback} bars` },
    trendFilter: { pass: ready ? c.close > t : null, detail: `close ${fmt(c.close)} vs EMA${cfg.trendEma} ${fmt(t)}` },
    emaSlope: { pass: ready ? slowRising : null, detail: `EMA${cfg.slowEma} over ${cfg.slopeLookback} bars` },
    rsiRange: { pass: ready ? S.rsi[i]! >= cfg.rsiMin && S.rsi[i]! <= cfg.rsiMax : null, detail: `RSI ${fmt(S.rsi[i] ?? NaN)} in ${cfg.rsiMin}–${cfg.rsiMax}` },
    macd: { pass: ready ? S.macd[i]! > S.macdSignal[i]! : null, detail: `MACD ${fmt(S.macd[i] ?? NaN)} vs signal ${fmt(S.macdSignal[i] ?? NaN)}` },
    relVolume: { pass: rv == null ? (complete ? null : false) : rv >= cfg.minRelativeVolume, detail: rv == null ? (complete ? "not enough volume history" : "bar incomplete — not compared") : `${rv.toFixed(2)}× average (min ${cfg.minRelativeVolume})` },
    adx: { pass: ready ? S.adx[i]! > cfg.minAdx : null, detail: `ADX ${fmt(S.adx[i] ?? NaN)} (min ${cfg.minAdx})` },
    priceAction: { pass: ready ? priceActionPass : null, detail: breakout ? "breakout above recent highs" : pullback ? "pullback to fast EMA and bounce" : "no breakout or pullback" },
    dataSufficiency: { pass: ready, detail: ready ? `${i + 1} bars available` : `needs ${S.warmup + 1} bars` },
    riskPlan: { pass: plan.plan != null, detail: plan.plan ? `stop ${fmt(plan.plan.stop)} · qty ${plan.plan.qty}` : (plan.reason ?? "invalid") },
  };

  const checks: CheckResult[] = CONDITION_IDS.map((id) => {
    const set = cfg.conditions[id];
    const alwaysMandatory = ALWAYS_MANDATORY.includes(id);
    return {
      id, label: CONDITION_LABELS[id],
      enabled: set.enabled || alwaysMandatory,
      mandatory: set.mandatory || alwaysMandatory,
      pass: set.enabled || alwaysMandatory ? raw[id].pass : null,
      detail: raw[id].detail,
    };
  });

  // Group members are judged by their group (AND/OR), not by the flat mandatory/optional rules.
  const grouped = new Set<ConditionId>((cfg.groups ?? []).flatMap((g) => g.members));
  const groups: GroupResult[] = (cfg.groups ?? []).map((g) => {
    const passes = g.members.map((m) => checks.find((k) => k.id === m)?.pass === true);
    const pass = g.members.length > 0 && (g.op === "AND" ? passes.every(Boolean) : passes.some(Boolean));
    return { id: g.id, op: g.op, members: g.members, pass };
  });
  const flat = checks.filter((k) => !grouped.has(k.id));
  const failedMandatory = [
    ...flat.filter((k) => k.enabled && k.mandatory && k.pass !== true).map((k) => k.id),
    ...groups.filter((g) => !g.pass).map((g) => `group:${g.id}`),
  ];
  const optionalPassed = flat.filter((k) => k.enabled && !k.mandatory).every((k) => k.pass !== false);
  const signal = failedMandatory.length === 0 && optionalPassed && ready ? "BUY" : "WAIT";
  return {
    index: i, time: c.time, signal, checks, failedMandatory, groups,
    plan: signal === "BUY" ? plan.plan : null,
    planReason: plan.reason,
  };
}

/** True when the fast EMA crossed below the slow EMA on bar i (used for the EMA exit). */
export function emaCrossedDown(S: SeriesBundle, i: number): boolean {
  return crossedBelow(S.fast, S.slow, i);
}

export function round2(v: number): number { return Math.round(v * 100) / 100; }
function fmt(v: number): string { return Number.isFinite(v) ? v.toFixed(2) : "—"; }
