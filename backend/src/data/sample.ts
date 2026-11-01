/**
 * SAMPLE data only: a deterministic pseudo-random walk shaped like 1-minute NSE bars.
 * It is NOT market data. Every response that uses it is labelled source: "SAMPLE".
 */
import type { Candle } from "../domain/candles.js";
import { DAY_MS, IST_OFFSET_MS } from "../domain/candles.js";

export const SAMPLE_INSTRUMENTS = [
  { symbol: "RELIANCE", name: "Reliance Industries", exchange: "NSE", basePrice: 2850, sector: "Energy" },
  { symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE", basePrice: 3900, sector: "IT" },
  { symbol: "INFY", name: "Infosys", exchange: "NSE", basePrice: 1520, sector: "IT" },
  { symbol: "HDFCBANK", name: "HDFC Bank", exchange: "NSE", basePrice: 1680, sector: "Banking" },
  { symbol: "ICICIBANK", name: "ICICI Bank", exchange: "NSE", basePrice: 1240, sector: "Banking" },
] as const;

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

const SAMPLE_SPAN_DAYS = 120;

/** Generates `days` sessions of 1-minute bars (09:15–15:29 IST), oldest first. */
export function sampleCandles(symbol: string, days = 60, basePrice = 1000): Candle[] {
  const seedBase = [...symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  const rnd = seeded(seedBase);
  const out: Candle[] = [];
  let price = basePrice;
  // Start 'days' sessions back, at the most recent IST midnight-aligned date.
  const todayIst = Math.floor((Date.now() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  // Always run the same fixed span so the price path (and the last close) does not depend on how many days a caller asks for.
  const span = Math.max(days, SAMPLE_SPAN_DAYS);
  for (let d = span; d >= 1; d--) {
    const dayStart = todayIst - d * DAY_MS;
    const dow = new Date(dayStart + IST_OFFSET_MS).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const openUtc = dayStart + (9 * 60 + 15) * 60_000;
    for (let m = 0; m < 375; m++) {
      const t = openUtc + m * 60_000;
      const drift = 0.00004 + Math.sin(d / 5) * 0.00003;
      const move = (rnd() - 0.5) * 0.0016 + drift;
      const open = price;
      const close = Math.max(1, price * (1 + move));
      const high = Math.max(open, close) * (1 + rnd() * 0.0006);
      const low = Math.min(open, close) * (1 - rnd() * 0.0006);
      const volume = Math.round(2000 + rnd() * 8000 + (m < 15 ? 6000 : 0));
      if (d <= days) out.push({ time: t, open: round(open), high: round(high), low: round(low), close: round(close), volume });
      price = close;
    }
  }
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;
