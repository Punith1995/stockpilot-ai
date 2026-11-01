/** Human-readable age, e.g. "5 min", "3 h", "2 d". */
export function ageText(ageMs: number | null): string {
  if (ageMs == null) return "—";
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)} min`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)} h`;
  return `${Math.round(ageMs / 86_400_000)} d`;
}

/**
 * Freshness of the last bar on a chart. Only a connected Kite feed can be "Live" or "Delayed";
 * anything else (including SAMPLE data) is "Not live", whatever the bar's age.
 */
export function chartFreshness(opts: { live: boolean; ageMs: number | null; barMinutes: number }): { text: string; tone: string } {
  const age = ageText(opts.ageMs);
  if (!opts.live) return { text: `Not live · last bar ${age} old`, tone: "text-amber-200" };
  if (opts.ageMs != null && opts.ageMs <= 2 * opts.barMinutes * 60_000) return { text: "Live", tone: "text-emerald-300" };
  return { text: `Delayed by ${age}`, tone: "text-amber-200" };
}
