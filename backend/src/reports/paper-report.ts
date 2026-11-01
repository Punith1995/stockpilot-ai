import type { PaperPosition, PaperTrade } from "../paper/engine.js";

export type ReportPeriod = "daily" | "weekly" | "monthly";
const IST_MS = 19_800_000;

export interface ReportRow {
  label: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
}

export interface PaperReport {
  period: ReportPeriod;
  rows: ReportRow[];
  totals: Omit<ReportRow, "label" | "maxDrawdown"> & { maxDrawdown: number };
  risk: {
    openPositions: number;
    capitalAtRisk: number;
    exposure: number;
    dailyLossLimit: number;
    todayRealizedPnl: number;
    dailyLossUsedPct: number;
  };
  note: string;
}

/** IST calendar date (as YYYY-MM-DD) for a UTC millisecond timestamp. */
const istDate = (ms: number): Date => new Date(ms + IST_MS);

function bucketLabel(ms: number, period: ReportPeriod): string {
  const d = istDate(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (period === "monthly") return day.toISOString().slice(0, 7);
  if (period === "weekly") {
    const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
    day.setUTCDate(day.getUTCDate() - dow);
    return `Week of ${day.toISOString().slice(0, 10)}`;
  }
  return day.toISOString().slice(0, 10);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function buildPaperReport(input: {
  trades: PaperTrade[];
  positions: PaperPosition[];
  startCapital: number;
  maxDailyLossPct: number;
  period: ReportPeriod;
  from?: number;
  to?: number;
  nowMs: number;
}): PaperReport {
  const { trades, positions, startCapital, maxDailyLossPct, period, nowMs } = input;
  const filtered = trades.filter((t) => (input.from == null || t.exitTime >= input.from) && (input.to == null || t.exitTime <= input.to));
  const groups = new Map<string, PaperTrade[]>();
  for (const t of [...filtered].sort((a, b) => a.exitTime - b.exitTime)) {
    const key = bucketLabel(t.exitTime, period);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const summarize = (label: string, list: PaperTrade[]): ReportRow => {
    const wins = list.filter((t) => t.netPnl > 0);
    const losses = list.filter((t) => t.netPnl <= 0);
    const net = list.reduce((s, t) => s + t.netPnl, 0);
    let peak = 0, cum = 0, maxDd = 0;
    for (const t of list) { cum += t.netPnl; peak = Math.max(peak, cum); maxDd = Math.max(maxDd, peak - cum); }
    const avg = (xs: PaperTrade[]) => (xs.length ? xs.reduce((s, t) => s + t.netPnl, 0) / xs.length : 0);
    return {
      label,
      trades: list.length,
      wins: wins.length,
      losses: losses.length,
      winRate: list.length ? round2((wins.length / list.length) * 100) : 0,
      grossPnl: round2(list.reduce((s, t) => s + (t.exit - t.entry) * t.qty, 0)),
      costs: round2(list.reduce((s, t) => s + (t.costs ?? 0), 0)),
      netPnl: round2(net),
      avgWin: round2(avg(wins)),
      avgLoss: round2(avg(losses)),
      maxDrawdown: round2(maxDd),
    };
  };

  const rows = [...groups.entries()].map(([label, list]) => summarize(label, list));
  const totalRow = summarize("Total", filtered);
  const { label: _l, ...totals } = totalRow;

  const todayKey = bucketLabel(nowMs, "daily");
  const todayRealized = round2((groups.get(todayKey) ?? []).reduce((s, t) => s + t.netPnl, 0));
  const dailyLossLimit = round2((startCapital * maxDailyLossPct) / 100);
  return {
    period,
    rows,
    totals: { ...totals, maxDrawdown: totalRow.maxDrawdown },
    risk: {
      openPositions: positions.length,
      capitalAtRisk: round2(positions.reduce((s, p) => s + p.riskAmount, 0)),
      exposure: round2(positions.reduce((s, p) => s + p.qty * p.entry, 0)),
      dailyLossLimit,
      todayRealizedPnl: todayRealized,
      dailyLossUsedPct: dailyLossLimit > 0 ? round2((Math.max(0, -todayRealized) / dailyLossLimit) * 100) : 0,
    },
    note: "Paper trades only, from memory since the last restart. Charges are included in net P&L. Times are IST.",
  };
}
