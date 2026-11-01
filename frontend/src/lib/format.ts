export const fmtMoney = (n: number | null | undefined): string =>
  n == null ? "—" : "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const fmtNum = (n: number | null | undefined, digits = 2): string =>
  n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: digits });

export const fmtPct = (n: number | null | undefined): string => (n == null ? "—" : `${n.toFixed(2)}%`);

/** Epoch ms → IST wall-clock string. */
export const fmtIst = (ms: number): string =>
  new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export const REASON_LABELS: Record<string, string> = {
  STOP: "Stop hit",
  TRAIL_STOP: "Trailing stop",
  TARGET: "Target hit",
  EMA_CROSS_DOWN: "EMA cross down",
  MAX_HOLD: "Max hold time",
  END_OF_DATA: "End of data",
  EMERGENCY_FLATTEN: "Emergency flatten",
  STRATEGY_EXIT: "Strategy exit",
};
