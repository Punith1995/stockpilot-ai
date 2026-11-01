/**
 * One place that decides where candles come from.
 * - No Kite session: every symbol is SAMPLE data (generated).
 * - Kite session: the five sample stocks load first (1-minute for 60 sessions, daily for about 400), and refresh every 5 minutes.
 *   Any other NSE equity loads on demand, the first time a request names it, and is cached for 5 minutes.
 * Kite calls are rate-limited inside KiteHistorical.
 */
import type { Env } from "../config/env.js";
import type { KiteService } from "../broker/kite.js";
import type { KiteHistorical } from "./kite-historical.js";
import { SAMPLE_INSTRUMENTS, sampleCandles } from "./sample.js";
import { aggregateDaily, istParts, type Candle } from "../domain/candles.js";
import { AppError } from "../utils/errors.js";

const REFRESH_MS = 5 * 60_000;
const MINUTE_DAYS = 60;
const DAILY_DAYS = 400;
const CORE = new Set<string>(SAMPLE_INSTRUMENTS.map((i) => i.symbol));
/** Other stocks kept in memory at once. Each holds about 60 days of minute bars (roughly 2 MB), so the cache is capped. */
const MAX_EXTRA = 40;

/** Keeps the candles belonging to the last `days` IST sessions. */
export function lastSessions(cs: Candle[], days: number): Candle[] {
  const keys = [...new Set(cs.map((c) => istParts(c.time).dayKey))];
  const keep = new Set(keys.slice(-days));
  return cs.filter((c) => keep.has(istParts(c.time).dayKey));
}

interface StockBars { minute: Candle[]; daily: Candle[]; at: number }

export class MarketData {
  private stocks = new Map<string, StockBars>();
  private sampleCache = new Map<string, Candle[]>();
  private inflight: Promise<void> | null = null;
  private loading = new Map<string, Promise<void>>();
  loadedAt: string | null = null;
  lastError: string | null = null;

  constructor(private env: Env, private kite: KiteService, private kiteData: KiteHistorical) {}

  /** True when a Kite session is active and the five core stocks have loaded. */
  get live(): boolean { return this.kite.status().connected && CORE.size > 0 && this.coreLoaded(); }
  label(): "KITE" | "SAMPLE" { return this.live ? "KITE" : "SAMPLE"; }
  private coreLoaded(): boolean { return [...CORE].every((s) => this.stocks.has(s)); }

  /** Symbols a request may name: the NSE list when live, otherwise the sample five. */
  isKnown(symbol: string): boolean {
    if (this.kite.status().connected && this.kiteData.instrumentCount > 0) return Boolean(this.kiteData.instrument(symbol));
    return CORE.has(symbol);
  }
  /** Kite's full NSE equity list when live; the sample five otherwise. */
  universe(): { symbol: string; name: string; lotSize: number; sector?: string }[] {
    if (this.live && this.kiteData.instrumentCount > 0) return this.kiteData.allInstruments().map((i) => ({ symbol: i.symbol, name: i.name, lotSize: i.lotSize }));
    return SAMPLE_INSTRUMENTS.map((i) => ({ symbol: i.symbol, name: i.name, lotSize: 1, sector: i.sector }));
  }

  sampleBars(sym: string, days: number): Candle[] {
    const key = `${sym}:${days}`;
    let c = this.sampleCache.get(key);
    if (!c) {
      c = sampleCandles(sym, days, SAMPLE_INSTRUMENTS.find((i) => i.symbol === sym)?.basePrice ?? 1000);
      this.sampleCache.set(key, c);
    }
    return c;
  }

  /** 1-minute bars for the last `days` sessions. */
  bars(sym: string, days = 30): Candle[] {
    const s = this.stocks.get(sym);
    if (this.live && s) return lastSessions(s.minute, days);
    return this.sampleBars(sym, days);
  }

  /** Daily bars for the last `days` sessions (needs ~200 for the 200 EMA). */
  dailyBars(sym: string, days = 300): Candle[] {
    const s = this.stocks.get(sym);
    if (this.live && s) return s.daily.slice(-days);
    return aggregateDaily(this.sampleBars(sym, Math.max(days, 2)));
  }

  /** Loads or refreshes the five core stocks when a session is active. Concurrent callers share one load. */
  async ensure(): Promise<void> {
    if (!this.kite.status().connected) {
      this.stocks.clear();
      return;
    }
    const core = [...CORE].map((s) => this.stocks.get(s));
    const fresh = core.every((s) => s && Date.now() - s.at < REFRESH_MS);
    if (fresh) return;
    if (!this.inflight) this.inflight = this.warmCore().finally(() => { this.inflight = null; });
    // Already loaded: serve the current data and let the refresh finish in the background.
    if (this.coreLoaded()) return;
    return this.inflight;
  }

  /** Loads any named NSE stocks that are not cached or are stale. Core stocks are handled by ensure(). */
  async loadSymbols(symbols: string[], force = false): Promise<void> {
    const token = this.kite.accessToken();
    if (!token || !this.env.KITE_API_KEY) return;
    for (const sym of new Set(symbols)) {
      if (!this.kiteData.instrument(sym)) continue;
      const cached = this.stocks.get(sym);
      if (!force && cached && Date.now() - cached.at < REFRESH_MS) continue;
      let p = this.loading.get(sym);
      if (!p) {
        p = this.fetchStock(sym, token).finally(() => this.loading.delete(sym));
        this.loading.set(sym, p);
      }
      await p;
    }
  }

  private async fetchStock(sym: string, token: string): Promise<void> {
    const apiKey = this.env.KITE_API_KEY!;
    try {
      const minute = (await this.kiteData.fetchCandles(apiKey, token, sym, "1", MINUTE_DAYS)).candles;
      const daily = (await this.kiteData.fetchCandles(apiKey, token, sym, "D", DAILY_DAYS)).candles;
      this.stocks.set(sym, { minute, daily, at: Date.now() });
      this.evict();
    } catch (e) {
      if ((e as { code?: string }).code === "SESSION_EXPIRED") {
        this.kite.markExpired();
        this.stocks.clear();
        throw new AppError(401, "SESSION_EXPIRED", "Kite session expired. Log in again.");
      }
      throw new AppError(503, "KITE_DATA_UNAVAILABLE", `Kite data for ${sym} could not be loaded right now.`);
    }
  }

  /** Keeps at most MAX_EXTRA non-core stocks; the least recently loaded go first. */
  private evict(): void {
    const extra = [...this.stocks.entries()].filter(([sym]) => !CORE.has(sym)).sort((a, b) => a[1].at - b[1].at);
    while (extra.length > MAX_EXTRA) this.stocks.delete(extra.shift()![0]);
  }

  private timer: ReturnType<typeof setInterval> | null = null;
  /** Refreshes every cached stock every 5 minutes while a session is active. The timer does not keep the process alive. */
  startBackground(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.refreshAll().catch(() => undefined); }, REFRESH_MS);
    this.timer.unref();
  }

  async refreshAll(): Promise<void> {
    if (!this.kite.status().connected) return;
    await this.ensure();
    const token = this.kite.accessToken();
    if (!token) return;
    for (const sym of [...this.stocks.keys()]) {
      if (CORE.has(sym)) continue; // core stocks are refreshed by ensure()
      try { await this.loadSymbols([sym], true); } catch { /* one stock failing does not stop the others; its old data stays until the next pass */ }
    }
  }

  private async warmCore(): Promise<void> {
    const token = this.kite.accessToken();
    if (!token || !this.env.KITE_API_KEY) return;
    const apiKey = this.env.KITE_API_KEY;
    try {
      if (this.kiteData.instrumentCount === 0) await this.kiteData.loadInstruments(apiKey, token);
      for (const i of SAMPLE_INSTRUMENTS) {
        const minute = (await this.kiteData.fetchCandles(apiKey, token, i.symbol, "1", MINUTE_DAYS)).candles;
        const daily = (await this.kiteData.fetchCandles(apiKey, token, i.symbol, "D", DAILY_DAYS)).candles;
        this.stocks.set(i.symbol, { minute, daily, at: Date.now() });
      }
      this.loadedAt = new Date().toISOString();
      this.lastError = null;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "SESSION_EXPIRED") {
        this.kite.markExpired();
        this.stocks.clear();
        this.lastError = "Kite session expired. Log in again. Showing SAMPLE data.";
      } else {
        this.lastError = code === "UNKNOWN_INSTRUMENT" ? `${(e as Error).message}. Showing SAMPLE data.` : "Kite data could not be loaded. Showing SAMPLE data.";
      }
    }
  }

  status() {
    return { live: this.live, source: this.label(), loadedAt: this.loadedAt, symbols: this.stocks.size, universeSize: this.kiteData.instrumentCount, lastError: this.lastError, minuteDays: MINUTE_DAYS, dailyDays: DAILY_DAYS };
  }
}
