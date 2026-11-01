import { describe, expect, it } from "vitest";
import { buildPaperReport } from "../src/reports/paper-report.js";

const IST_MS = 19_800_000;
const at = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h) - IST_MS; // IST wall-clock to UTC ms
const t = (exitTime: number, netPnl: number) => ({ symbol: "X", qty: 1, entry: 100, exit: 100 + netPnl, entryTime: exitTime - 1000, exitTime, reason: "TARGET", netPnl, costs: 2 });

describe("paper report", () => {
  const trades = [t(at(2026, 10, 26), 500), t(at(2026, 10, 26, 14), -200), t(at(2026, 10, 27), -100), t(at(2026, 11, 2), 300)];
  const base = { trades, positions: [], startCapital: 100000, maxDailyLossPct: 2, nowMs: at(2026, 10, 27) };

  it("groups by IST day, with win rate and drawdown", () => {
    const r = buildPaperReport({ ...base, period: "daily" });
    expect(r.rows.map((x) => x.label)).toEqual(["2026-10-26", "2026-10-27", "2026-11-02"]);
    expect(r.rows[0]).toMatchObject({ trades: 2, wins: 1, losses: 1, winRate: 50, netPnl: 300 });
    expect(r.rows[0].maxDrawdown).toBe(200);
  });

  it("groups weeks from Monday and months by calendar month", () => {
    expect(buildPaperReport({ ...base, period: "weekly" }).rows.map((x) => x.label)).toEqual(["Week of 2026-10-26", "Week of 2026-11-02"]);
    expect(buildPaperReport({ ...base, period: "monthly" }).rows.map((x) => x.label)).toEqual(["2026-10", "2026-11"]);
  });

  it("filters by exit time and reports today's loss against the daily limit", () => {
    const r = buildPaperReport({ ...base, period: "daily", from: at(2026, 10, 27), to: at(2026, 10, 31) });
    expect(r.totals.trades).toBe(1);
    expect(r.risk.todayRealizedPnl).toBe(-100);
    expect(r.risk.dailyLossLimit).toBe(2000);
    expect(r.risk.dailyLossUsedPct).toBe(5);
  });
});
