/**
 * Kite Connect historical candles and NSE instrument list.
 *
 * UNVERIFIED: endpoints, the "token key:value" auth header and the candle response shape follow the
 * public Kite Connect docs as remembered. They have not been checked against the live service.
 * Pure parsing and chunking helpers are unit-tested with fixtures; network calls are not.
 */
import type { Candle } from "../domain/candles.js";
import { RateLimiter } from "./throttle.js";

export const KITE_INTERVALS = { "1": "minute", "5": "5minute", "15": "15minute", "60": "60minute", D: "day" } as const;
export type KiteInterval = keyof typeof KITE_INTERVALS;

/** Kite limits how long a span one minute-candle request may cover. 60 days is the conservative figure used here. */
export const MAX_DAYS_PER_REQUEST: Record<KiteInterval, number> = { "1": 60, "5": 100, "15": 200, "60": 400, D: 2000 };

export interface Instrument { token: number; symbol: string; name: string; lotSize: number; exchange: string; type: string }

/** Minimal RFC-4180 CSV parser: handles quoted fields, escaped quotes and commas inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.length)) rows.push(row);
  return rows;
}

/** Keeps only NSE equity instruments from the instruments CSV. */
export function parseNseEquities(csv: string): Instrument[] {
  const [header, ...rows] = parseCsv(csv);
  const idx = (name: string) => header.indexOf(name);
  const [iTok, iSym, iName, iLot, iExch, iType] = ["instrument_token", "tradingsymbol", "name", "lot_size", "exchange", "instrument_type"].map(idx);
  if ([iTok, iSym, iExch, iType].some((i) => i < 0)) throw new Error("Unexpected instruments CSV header");
  return rows
    .filter((r) => r[iExch] === "NSE" && r[iType] === "EQ")
    .map((r) => ({ token: Number(r[iTok]), symbol: r[iSym], name: iName >= 0 ? r[iName] : r[iSym], lotSize: iLot >= 0 ? Number(r[iLot]) || 1 : 1, exchange: "NSE", type: "EQ" }))
    .filter((i) => Number.isFinite(i.token) && /^[A-Z0-9&-]{1,20}$/.test(i.symbol));
}

/** Kite expects IST wall-clock time as "yyyy-mm-dd hh:mm:ss" (docs: /instruments/historical). */
export function kiteStamp(ms: number): string {
  return new Date(ms + 19_800_000).toISOString().slice(0, 19).replace("T", " ");
}

/** Splits [from, to] into windows no longer than the interval's Kite limit. */
export function chunkRange(fromMs: number, toMs: number, maxDays: number): { from: number; to: number }[] {
  const span = maxDays * 86_400_000;
  const out: { from: number; to: number }[] = [];
  for (let start = fromMs; start < toMs; start += span) out.push({ from: start, to: Math.min(toMs, start + span) });
  return out;
}

/** Parses Kite's "2026-01-05T09:15:00+0530" timestamps into epoch ms. Rejects anything else. */
export function parseKiteTime(s: string): number {
  const norm = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(norm);
  if (!Number.isFinite(ms)) throw new Error(`Bad timestamp: ${s}`);
  return ms;
}

/** Converts Kite's [ts, o, h, l, c, v] rows into Candle objects. Invalid rows are skipped and counted. */
export function parseKiteCandles(raw: unknown[]): { candles: Candle[]; skipped: number } {
  let skipped = 0;
  const candles: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) { skipped++; continue; }
    try {
      candles.push({ time: parseKiteTime(String(row[0])), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) });
    } catch { skipped++; }
  }
  return { candles, skipped };
}

/** Index instruments (segment INDICES) from the instruments CSV. Names contain spaces, so they never match the equity filter. */
export function parseIndices(csv: string): Instrument[] {
  const [header, ...rows] = parseCsv(csv);
  const idx = (name: string) => header.indexOf(name);
  const [iTok, iSym, iExch, iSeg] = ["instrument_token", "tradingsymbol", "exchange", "segment"].map(idx);
  if ([iTok, iSym, iExch, iSeg].some((i) => i < 0)) return [];
  return rows
    .filter((r) => r[iSeg] === "INDICES" && (r[iExch] === "NSE" || r[iExch] === "BSE"))
    .map((r) => ({ token: Number(r[iTok]), symbol: r[iSym], name: r[iSym], lotSize: 1, exchange: r[iExch], type: "INDEX" }))
    .filter((i) => Number.isFinite(i.token) && i.symbol.length > 0);
}

export class KiteHistorical {
  private bysymbol = new Map<string, Instrument>();
  private indexBySymbol = new Map<string, Instrument>();
  /** Kite allows about 3 historical requests per second. Every call goes through this limiter. */
  private limiter = new RateLimiter(340);
  instrumentsLoadedAt: string | null = null;

  get instrumentCount(): number { return this.bysymbol.size; }
  instrument(symbol: string): Instrument | undefined { return this.bysymbol.get(symbol); }
  /** Every NSE equity symbol from the last instruments load. */
  allInstruments(): Instrument[] { return [...this.bysymbol.values()]; }

  indexInstrument(name: string): Instrument | undefined { return this.indexBySymbol.get(name); }

  /** Kite's /user/profile. Used by the connection check. */
  async profile(apiKey: string, accessToken: string): Promise<{ userId: string | null }> {
    await this.limiter.wait();
    const res = await fetch("https://api.kite.trade/user/profile", { headers: { "X-Kite-Version": "3", Authorization: `token ${apiKey}:${accessToken}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 403) throw Object.assign(new Error("Kite session expired"), { code: "SESSION_EXPIRED" });
    if (!res.ok) throw new Error(`Profile request failed (${res.status})`);
    const json = (await res.json()) as { data?: { user_id?: string } };
    return { userId: json.data?.user_id ?? null };
  }

  async loadInstruments(apiKey: string, accessToken: string): Promise<number> {
    await this.limiter.wait();
    const res = await fetch("https://api.kite.trade/instruments/NSE", { headers: { "X-Kite-Version": "3", Authorization: `token ${apiKey}:${accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 403) throw Object.assign(new Error("Kite session expired"), { code: "SESSION_EXPIRED" });
    if (!res.ok) throw new Error(`Instruments request failed (${res.status})`);
    const text = await res.text();
    const list = parseNseEquities(text);
    this.bysymbol = new Map(list.map((i) => [i.symbol, i]));
    this.indexBySymbol = new Map(parseIndices(text).map((i) => [i.symbol, i]));
    this.instrumentsLoadedAt = new Date().toISOString();
    return list.length;
  }

  async fetchIndexCandles(apiKey: string, accessToken: string, name: string, interval: KiteInterval, days: number) {
    const inst = this.indexBySymbol.get(name);
    if (!inst) throw Object.assign(new Error(`${name} is not in the loaded index list`), { code: "UNKNOWN_INSTRUMENT" });
    return this.fetchFor(inst, apiKey, accessToken, interval, days);
  }

  async fetchCandles(apiKey: string, accessToken: string, symbol: string, interval: KiteInterval, days: number): Promise<{ candles: Candle[]; skipped: number; requests: number }> {
    const inst = this.bysymbol.get(symbol);
    if (!inst) throw Object.assign(new Error(`${symbol} is not in the loaded NSE instrument list`), { code: "UNKNOWN_INSTRUMENT" });
    return this.fetchFor(inst, apiKey, accessToken, interval, days);
  }

  private async fetchFor(inst: Instrument, apiKey: string, accessToken: string, interval: KiteInterval, days: number): Promise<{ candles: Candle[]; skipped: number; requests: number }> {
    const to = Date.now(), from = to - days * 86_400_000;
    const windows = chunkRange(from, to, MAX_DAYS_PER_REQUEST[interval]);
    const all: Candle[] = [];
    let skipped = 0;
    for (const w of windows) {
      const url = `https://api.kite.trade/instruments/historical/${inst.token}/${KITE_INTERVALS[interval]}?from=${encodeURIComponent(kiteStamp(w.from))}&to=${encodeURIComponent(kiteStamp(w.to))}`;
      await this.limiter.wait();
      const res = await fetch(url, { headers: { "X-Kite-Version": "3", Authorization: `token ${apiKey}:${accessToken}` }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 403) throw Object.assign(new Error("Kite session expired"), { code: "SESSION_EXPIRED" });
      if (!res.ok) throw new Error(`Historical request failed (${res.status})`);
      const json = (await res.json()) as { data?: { candles?: unknown[] } };
      const parsed = parseKiteCandles(json.data?.candles ?? []);
      all.push(...parsed.candles);
      skipped += parsed.skipped;
    }
    const byTime = new Map(all.map((c) => [c.time, c]));
    return { candles: [...byTime.values()].sort((a, b) => a.time - b.time), skipped, requests: windows.length };
  }

  /**
   * Live quotes via Kite's full quote endpoint. UNVERIFIED: endpoint shape and field names
   * (data[key].last_price, data[key].ohlc.close) are from memory of the public docs.
   */
  async fetchQuotes(apiKey: string, accessToken: string, keys: string[]): Promise<Record<string, { last: number; prevClose: number }>> {
    const qs = keys.map((k) => `i=${encodeURIComponent(k)}`).join("&");
    const res = await fetch(`https://api.kite.trade/quote?${qs}`, { headers: { "X-Kite-Version": "3", Authorization: `token ${apiKey}:${accessToken}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 403) throw Object.assign(new Error("Kite session expired"), { code: "SESSION_EXPIRED" });
    if (!res.ok) throw new Error(`Quote request failed (${res.status})`);
    const json = (await res.json()) as { data?: Record<string, { last_price?: number; ohlc?: { close?: number } }> };
    const out: Record<string, { last: number; prevClose: number }> = {};
    for (const k of keys) {
      const q = json.data?.[k];
      if (q && Number.isFinite(q.last_price) && Number.isFinite(q.ohlc?.close)) out[k] = { last: q.last_price!, prevClose: q.ohlc!.close! };
    }
    return out;
  }
}
