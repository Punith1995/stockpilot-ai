/**
 * Pre-trade risk gate. Every new entry (paper or, later, live) must pass checkEntry().
 * Blocking new entries never closes existing positions; exits are handled separately.
 */
export interface RiskLimits {
  capital: number;
  maxOpenPositions: number;
  maxDailyLossPct: number;     // stop new entries after realized loss of this % of capital in a day
  maxTradesPerDay: number;
  maxOrderValuePct: number;    // one order may not exceed this % of capital
  maxExposurePerStockPct: number;
}

export interface RiskSnapshot {
  openPositions: number;
  heldSymbols: string[];
  dailyRealizedPnl: number;
  tradesToday: number;
  exposureBySymbol: Record<string, number>; // ₹ value held per symbol
  emergencyStop: boolean;
}

export interface EntryRequest { symbol: string; orderValue: number }
export interface RiskDecision { allowed: boolean; reasons: string[] }

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  capital: 100000,
  maxOpenPositions: 5,
  maxDailyLossPct: 2,
  maxTradesPerDay: 10,
  maxOrderValuePct: 25,
  maxExposurePerStockPct: 25,
};

export function checkEntry(limits: RiskLimits, snap: RiskSnapshot, req: EntryRequest): RiskDecision {
  const reasons: string[] = [];
  if (snap.emergencyStop) reasons.push("Emergency stop is active");
  if (snap.heldSymbols.includes(req.symbol)) reasons.push(`Already holding ${req.symbol}`);
  if (snap.openPositions >= limits.maxOpenPositions) reasons.push(`Maximum open positions (${limits.maxOpenPositions}) reached`);
  if (snap.dailyRealizedPnl <= -(limits.capital * limits.maxDailyLossPct) / 100) reasons.push(`Daily loss limit (${limits.maxDailyLossPct}% of capital) reached`);
  if (snap.tradesToday >= limits.maxTradesPerDay) reasons.push(`Maximum trades per day (${limits.maxTradesPerDay}) reached`);
  if (req.orderValue > (limits.capital * limits.maxOrderValuePct) / 100) reasons.push(`Order value exceeds ${limits.maxOrderValuePct}% of capital`);
  const after = (snap.exposureBySymbol[req.symbol] ?? 0) + req.orderValue;
  if (after > (limits.capital * limits.maxExposurePerStockPct) / 100) reasons.push(`Exposure to ${req.symbol} would exceed ${limits.maxExposurePerStockPct}% of capital`);
  return { allowed: reasons.length === 0, reasons };
}
