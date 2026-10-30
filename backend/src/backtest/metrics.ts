/**
 * Performance metrics. Definitions are stated next to each value so reports can explain them.
 */
import type { EquityPoint, TradeRecord } from "./engine.js";

export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;           // wins / closed trades × 100
  grossProfit: number;              // sum of net P&L of winning trades
  grossLoss: number;                // absolute sum of net P&L of losing trades
  netProfit: number;
  netReturnPct: number;             // netProfit / starting capital × 100
  profitFactor: number | null;      // grossProfit / grossLoss; null when there are no losing trades
  maxDrawdown: number;              // largest peak-to-trough fall of realized equity (₹)
  maxDrawdownPct: number;
  averageWin: number | null;
  averageLoss: number | null;       // negative number
  averageHoldingBars: number | null;
  expectancyPerTrade: number | null; // netProfit / trades (₹)
  expectancyR: number | null;        // average R-multiple per trade
  rewardToRisk: number | null;       // averageWin / |averageLoss|
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  monthlyReturns: { month: string; netPnl: number; returnPct: number; trades: number }[];
  warnings: string[];
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function computeMetrics(trades: TradeRecord[], startCapital: number, equity: EquityPoint[]): Metrics {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const wins = sorted.filter((t) => t.netPnl > 0);
  const losses = sorted.filter((t) => t.netPnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const netProfit = sorted.reduce((s, t) => s + t.netPnl, 0);

  let peak = equity[0]?.equity ?? startCapital, maxDd = 0, maxDdPct = 0;
  for (const p of equity) {
    peak = Math.max(peak, p.equity);
    const dd = peak - p.equity;
    if (dd > maxDd) { maxDd = dd; maxDdPct = peak > 0 ? (dd / peak) * 100 : 0; }
  }

  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  for (const t of sorted) {
    if (t.netPnl > 0) { curW++; curL = 0; } else { curL++; curW = 0; }
    maxW = Math.max(maxW, curW); maxL = Math.max(maxL, curL);
  }

  const monthly = new Map<string, { netPnl: number; trades: number }>();
  for (const t of sorted) {
    const month = new Date(t.exitTime + 19_800_000).toISOString().slice(0, 7);
    const m = monthly.get(month) ?? { netPnl: 0, trades: 0 };
    m.netPnl += t.netPnl; m.trades++;
    monthly.set(month, m);
  }

  const n = sorted.length;
  const avgWin = wins.length ? grossProfit / wins.length : null;
  const avgLoss = losses.length ? -grossLoss / losses.length : null;
  const warnings: string[] = [];
  if (n === 0) warnings.push("No closed trades — nothing to evaluate.");
  else if (n < 30) warnings.push(`Only ${n} trades — too few for a statistically meaningful conclusion.`);
  if (n > 0 && losses.length === 0) warnings.push("No losing trades — profit factor is not meaningful.");

  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? round((wins.length / n) * 100) : null,
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    netProfit: round(netProfit),
    netReturnPct: round((netProfit / startCapital) * 100),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    maxDrawdown: round(maxDd),
    maxDrawdownPct: round(maxDdPct),
    averageWin: avgWin == null ? null : round(avgWin),
    averageLoss: avgLoss == null ? null : round(avgLoss),
    averageHoldingBars: n ? round(sorted.reduce((s, t) => s + t.barsHeld, 0) / n, 1) : null,
    expectancyPerTrade: n ? round(netProfit / n) : null,
    expectancyR: n ? round(sorted.reduce((s, t) => s + t.rMultiple, 0) / n, 3) : null,
    rewardToRisk: avgWin != null && avgLoss != null && avgLoss < 0 ? round(avgWin / Math.abs(avgLoss)) : null,
    maxConsecutiveWins: maxW,
    maxConsecutiveLosses: maxL,
    monthlyReturns: [...monthly.entries()].map(([month, m]) => ({
      month, netPnl: round(m.netPnl), returnPct: round((m.netPnl / startCapital) * 100), trades: m.trades,
    })),
    warnings,
  };
}
