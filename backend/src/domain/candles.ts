/**
 * Candle model, validation, Indian session boundaries and timeframe aggregation.
 * NSE cash equities trade 09:15–15:30 IST, Monday to Friday. Exchange holidays are NOT
 * modelled here, so a holiday can appear as a session with no candles (reported as missing).
 */
export interface Candle {
  time: number;      // candle start, epoch milliseconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AggregatedCandle extends Candle {
  complete: boolean; // false when fewer base candles than expected (partial bar)
  count: number;     // number of base candles merged
}

export const IST_OFFSET_MS = 19_800_000;
export const DAY_MS = 86_400_000;
export const SESSION_OPEN_MIN = 9 * 60 + 15;  // 555
export const SESSION_CLOSE_MIN = 15 * 60 + 30; // 930

export interface IstParts {
  dayKey: number;   // IST calendar day index (days since epoch in IST)
  minutes: number;  // minutes since IST midnight
  weekday: number;  // 0 = Sunday … 6 = Saturday (IST)
}

export function istParts(ms: number): IstParts {
  const shifted = ms + IST_OFFSET_MS;
  const dayKey = Math.floor(shifted / DAY_MS);
  const d = new Date(shifted);
  return { dayKey, minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: d.getUTCDay() };
}

/** True when a candle starting at `ms` and lasting `intervalMin` lies inside the regular session. */
export function isInSession(ms: number, intervalMin = 1): boolean {
  const p = istParts(ms);
  return p.weekday >= 1 && p.weekday <= 5 && p.minutes >= SESSION_OPEN_MIN && p.minutes + intervalMin <= SESSION_CLOSE_MIN;
}

export interface SanitizeReport {
  candles: Candle[];
  dropped: { time: number; reason: string }[];
  duplicates: number;
}

/** Drops invalid OHLCV rows, sorts ascending and removes duplicate timestamps (keeps the last). */
export function sanitizeCandles(raw: Candle[]): SanitizeReport {
  const dropped: SanitizeReport["dropped"] = [];
  const byTime = new Map<number, Candle>();
  let duplicates = 0;
  for (const c of raw) {
    const nums = [c.time, c.open, c.high, c.low, c.close, c.volume];
    if (!nums.every((v) => Number.isFinite(v))) { dropped.push({ time: c.time, reason: "non-numeric value" }); continue; }
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) { dropped.push({ time: c.time, reason: "non-positive price" }); continue; }
    if (c.volume < 0) { dropped.push({ time: c.time, reason: "negative volume" }); continue; }
    if (c.high < c.low) { dropped.push({ time: c.time, reason: "high below low" }); continue; }
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) { dropped.push({ time: c.time, reason: "OHLC inconsistent" }); continue; }
    if (byTime.has(c.time)) duplicates++;
    byTime.set(c.time, c);
  }
  const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
  return { candles, dropped, duplicates };
}

/**
 * Aggregates base candles (e.g. 1-minute) into `intervalMin` buckets aligned to 09:15 IST.
 * Buckets never span two trading days or the session close. Volume is summed once per base candle.
 */
export function aggregate(base: Candle[], baseIntervalMin: number, intervalMin: number): AggregatedCandle[] {
  if (intervalMin % baseIntervalMin !== 0) throw new Error(`${intervalMin}m is not a multiple of ${baseIntervalMin}m`);
  const expected = intervalMin / baseIntervalMin;
  const buckets = new Map<number, AggregatedCandle>();
  for (const c of [...base].sort((a, b) => a.time - b.time)) {
    if (!isInSession(c.time, baseIntervalMin)) continue;
    const p = istParts(c.time);
    const slot = Math.floor((p.minutes - SESSION_OPEN_MIN) / intervalMin);
    const key = p.dayKey * 1000 + slot;
    const existing = buckets.get(key);
    if (!existing) {
      const startMin = SESSION_OPEN_MIN + slot * intervalMin;
      buckets.set(key, {
        time: p.dayKey * DAY_MS - IST_OFFSET_MS + startMin * 60_000,
        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        complete: false, count: 1,
      });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
      existing.count++;
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.time - b.time)
    .map((b) => ({ ...b, complete: b.count >= expected }));
}

/** Groups 1-minute sample candles into one candle per IST session. */
export function aggregateDaily(base: Candle[]): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let day = -1;
  for (const c of base) {
    const k = istParts(c.time).dayKey;
    if (!cur || k !== day) {
      if (cur) out.push(cur);
      day = k;
      cur = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    } else {
      const prevBar: Candle = cur as Candle;
      cur = { time: prevBar.time, open: prevBar.open, high: Math.max(prevBar.high, c.high), low: Math.min(prevBar.low, c.low), close: c.close, volume: prevBar.volume + c.volume };
    }
  }
  if (cur) out.push(cur);
  return out;
}
