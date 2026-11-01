/**
 * Enabled/disabled state and editable parameters for strategies, held in memory (resets on restart).
 * Disabled strategies cannot be backtested or included in the comparison.
 * The scanner and charts use the active strategy and are not affected by this switch.
 */
import { type Prepared, SIMPLE_STRATEGIES, strategyById } from "./library.js";

export const BUILT_IN_ID = "ema-momentum-pro";
export const BUILT_IN_NAME = "EMA Momentum Pro";
const enabled = new Map<string, boolean>();
export interface StrategyParams { targetR: number; maxHoldBars: number; stopAtr?: number }
const overrides = new Map<string, Partial<StrategyParams>>();

export const isEnabled = (id: string): boolean => enabled.get(id) !== false;
export const setEnabled = (id: string, value: boolean): void => { enabled.set(id, value); };
export const knownStrategyIds = (): string[] => [BUILT_IN_ID, ...SIMPLE_STRATEGIES.map((s) => s.id)];

/** Defaults come from the strategy definition. Target multiple, max hold and the ATR stop multiple are editable. */
export function paramsFor(id: string): (StrategyParams & { edited: boolean }) | null {
  const s = strategyById(id);
  if (!s) return null;
  const o = overrides.get(id) ?? {};
  return { targetR: o.targetR ?? s.targetR, maxHoldBars: o.maxHoldBars ?? s.maxHoldBars, stopAtr: s.stopAtr == null ? undefined : (o.stopAtr ?? s.stopAtr), edited: overrides.has(id) };
}
export function setParams(id: string, p: Partial<StrategyParams>): void { overrides.set(id, { ...(overrides.get(id) ?? {}), ...p }); }
/** The strategy definition with any saved parameter edits applied. */
export function effectiveStrategy(id: string) {
  const s = strategyById(id);
  if (!s) return undefined;
  const p = paramsFor(id)!;
  const k = p.stopAtr;
  const stop = k == null ? s.stop : (ps: Prepared, i: number, entry: number) => { const a = (ps.atr14 as (number | null)[])[i]; return a == null ? null : entry - k * a; };
  return { ...s, targetR: p.targetR, maxHoldBars: p.maxHoldBars, stop };
}

export const registryItems = () => [
  { id: BUILT_IN_ID, name: BUILT_IN_NAME, enabled: isEnabled(BUILT_IN_ID), builtIn: true, editable: false },
  ...SIMPLE_STRATEGIES.map((s) => ({ id: s.id, name: s.name, enabled: isEnabled(s.id), builtIn: false, editable: true, params: paramsFor(s.id) })),
];
