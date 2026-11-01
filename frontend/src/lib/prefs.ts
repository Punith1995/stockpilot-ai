/** Per-browser convenience settings. Storage can be blocked or empty, so every access is guarded. */
export const TIMEFRAMES: [string, string][] = [["1", "1 min"], ["3", "3 min"], ["5", "5 min"], ["10", "10 min"], ["15", "15 min"], ["30", "30 min"], ["60", "1 hour"], ["240", "4 hour"], ["D", "1 day"]];
const KEY = "sp.defaultTimeframe";

export function getDefaultTimeframe(): string {
  try {
    const v = window.localStorage.getItem(KEY);
    return v && TIMEFRAMES.some(([x]) => x === v) ? v : "5";
  } catch { return "5"; }
}

export function setDefaultTimeframe(v: string): void {
  try { window.localStorage.setItem(KEY, v); } catch { /* storage unavailable: keep the default */ }
}
