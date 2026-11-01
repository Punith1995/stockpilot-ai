import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { aggregate, aggregateDaily, istParts, sanitizeCandles, type Candle } from "../domain/candles.js";
import { isEnabled } from "../strategies/registry.js";
import { adx, atr, bollinger, ema, macd, relativeVolume, rsi, sma, vwap } from "../indicators/index.js";
import { SIMPLE_STRATEGIES } from "../strategies/library.js";
import { effectiveStrategy } from "../strategies/registry.js";
import { runGeneric } from "../backtest/generic-engine.js";
const EMA_MOMENTUM_PRO_NAME = "EMA Momentum Pro";
import { sampleCandles, SAMPLE_INSTRUMENTS } from "../data/sample.js";
import type { MarketData } from "../data/market.js";
import { SAMPLE_INDICES } from "../data/indices.js";
import { runBacktest, splitByDay } from "../backtest/engine.js";
import { DEFAULT_RISK_LIMITS } from "../risk/risk-manager.js";
import type { AuditLog } from "../audit/log.js";
import { computeMetrics } from "../backtest/metrics.js";
import { CONDITION_IDS, CONDITION_LABELS, EMA_MOMENTUM_PRO, computeSeries, evaluateLong } from "../strategy/ema-momentum-pro.js";
import { PaperEngine } from "../paper/engine.js";
import { type KiteHistorical } from "../data/kite-historical.js";
import { buildPaperReport } from "../reports/paper-report.js";
import { recentErrors } from "../utils/recent-errors.js";
import { llmAnswer, MAX_QUESTION, ruleAnswer } from "../analyst/ask.js";
import { KiteService } from "../broker/kite.js";
import { ScanJobs } from "../data/scan-job.js";
import { AppError } from "../utils/errors.js";
import { requireAdmin } from "./middleware.js";

export interface Deps { env: Env; paper: PaperEngine; kite: KiteService; audit: AuditLog; kiteData: KiteHistorical; market: MarketData }

const symbolParam = z.string().regex(/^[A-Z0-9&-]{1,20}$/);
/** Minute intervals the sample candles can be aggregated to. */
export const INTERVAL_MINUTES = ["1", "3", "5", "10", "15", "30", "60", "240"] as const;
/** Number of distinct IST trading sessions in a candle list (works for any timeframe). */
export function countSessions(cs: Candle[]): number {
  return new Set(cs.map((c) => istParts(c.time).dayKey)).size;
}

const round2 = (n: number) => Math.round(n * 100) / 100;


/** Recent swing highs and lows (pivot of 3 bars each side) within the last `lookback` bars. */
export function swingLevels(candles: Candle[], lookback = 150): { support: number[]; resistance: number[] } {
  const start = Math.max(3, candles.length - lookback);
  const support: number[] = [], resistance: number[] = [];
  for (let i = start; i < candles.length - 3; i++) {
    const win = candles.slice(i - 3, i + 4);
    if (candles[i].low === Math.min(...win.map((c) => c.low))) support.push(round2(candles[i].low));
    if (candles[i].high === Math.max(...win.map((c) => c.high))) resistance.push(round2(candles[i].high));
  }
  return { support: support.slice(-3), resistance: resistance.slice(-3) };
}
const SAMPLE_NOTE = "All market data here is SAMPLE (generated), not real NSE data.";

export function createRouter({ env, paper, kite, audit, kiteData, market }: Deps): Router {
  const r = Router();
  const bars = (symbol: string, days = 30): Candle[] => market.bars(symbol, days);
  const src = () => market.label();
  const requireKnown = (symbol: string) => {
    if (!market.isKnown(symbol)) throw new AppError(404, "UNKNOWN_SYMBOL", `${symbol} is not a known stock`);
  };
  const admin = requireAdmin(env.ADMIN_TOKEN);

  // One active strategy shared by the chart, watchlists, scanner and backtests. Set from the Strategy Builder.
  type Overrides = z.infer<typeof overrideSchema>;
  let activeOverrides: Overrides = {};
  const applyOverrides = (base: typeof EMA_MOMENTUM_PRO, o: Overrides): typeof EMA_MOMENTUM_PRO => ({
    ...base,
    ...(o.rsiMin != null ? { rsiMin: o.rsiMin } : {}),
    ...(o.rsiMax != null ? { rsiMax: o.rsiMax } : {}),
    ...(o.minRelativeVolume != null ? { minRelativeVolume: o.minRelativeVolume } : {}),
    ...(o.minAdx != null ? { minAdx: o.minAdx } : {}),
    conditions: { ...base.conditions, ...(o.conditions ?? {}) },
    groups: o.groups ?? base.groups ?? [],
  });
  const activeCfg = () => applyOverrides(EMA_MOMENTUM_PRO, activeOverrides);
  const backtests: unknown[] = [];
  const journalNotes = new Map<string, { note: string; at: number }>();
  const watchlists = new Map<string, string[]>([["default", ["RELIANCE", "TCS", "INFY"]]]);

  const serverStartedAt = new Date().toISOString();
  r.get("/errors/recent", (_req, res) => res.json({ items: recentErrors(), note: "Server-side errors only. Messages are safe texts; no stack traces or request bodies." }));
  r.get("/status", (_req, res) => {
    const p = istParts(Date.now());
    const open = p.weekday >= 1 && p.weekday <= 5 && p.minutes >= 555 && p.minutes < 930;
    const live = market.live;
    res.json({ mode: "PAPER", dataSource: market.label(), liveTrading: "NOT_IMPLEMENTED", marketOpen: open, kite: kite.status(), marketData: market.status(), serverTime: new Date().toISOString(), serverStartedAt, alertWebhookConfigured: Boolean(env.ALERT_WEBHOOK_URL), note: live ? "Live Kite data (5 stocks, refreshed every few minutes). Trading is still paper only. Indices are SAMPLE." : SAMPLE_NOTE });
  });

  r.get("/market/status", (_req, res) => {
    const p = istParts(Date.now());
    const weekday = p.weekday >= 1 && p.weekday <= 5;
    res.json({ timezone: "Asia/Kolkata", session: "09:15–15:30 IST, Mon–Fri", open: weekday && p.minutes >= 555 && p.minutes < 930, holidayCalendar: "NOT_LOADED" });
  });

  r.get("/instruments", (_req, res) => res.json({ source: src(), items: market.universe(), note: market.live ? "All NSE equities from Kite's instrument list." : "Sample stocks. Log in to Kite to list all NSE equities." }));
  r.get("/indices/:name/chart", async (req, res, next) => {
    try {
      const name = decodeURIComponent(req.params.name);
      const idx = SAMPLE_INDICES.find((i) => i.symbol === name);
      if (!idx) throw new AppError(404, "UNKNOWN_INDEX", `${name} is not a known index`);
      const q = z.object({ interval: z.enum([...INTERVAL_MINUTES, "D"]).default("5"), days: z.coerce.number().int().min(2).max(60).default(20) }).parse(req.query);
      const token = kite.accessToken();
      let base: Candle[] | null = null;
      let note = "SAMPLE index data, generated. Not live.";
      if (token && env.KITE_API_KEY) {
        try {
          if (!kiteData.indexInstrument(name)) await kiteData.loadInstruments(env.KITE_API_KEY, token);
          base = (await kiteData.fetchIndexCandles(env.KITE_API_KEY, token, name, "1", q.days)).candles;
          note = "Live Kite index data (endpoint unverified against the live service).";
        } catch (e) {
          if ((e as { code?: string }).code === "SESSION_EXPIRED") { kite.markExpired(); note = "Kite session expired. Log in again. Showing SAMPLE index data."; }
          else note = `Kite index data unavailable (${(e as Error).message}). Showing SAMPLE index data.`;
        }
      }
      const source = base ? "KITE" : "SAMPLE";
      const minutes = base ?? sampleCandles(idx.symbol, q.days, idx.basePrice);
      const cs = q.interval === "D" ? aggregateDaily(minutes) : q.interval === "1" ? minutes : aggregate(minutes, 1, Number(q.interval));
      res.json({ source, name: idx.symbol, interval: q.interval, candles: cs.slice(-300), note });
    } catch (e) { next(e); }
  });

  // Connection check: calls each Kite endpoint once and reports what came back. Use it right after login.
  r.get("/broker/diagnose", admin, async (_req, res, next) => {
    try {
      const token = kite.accessToken();
      const key = env.KITE_API_KEY;
      if (!token || !key) { res.json({ connected: false, checks: [], note: "Log in to Kite first." }); return; }
      const checks: { name: string; ok: boolean; detail: string; ms: number }[] = [];
      const run = async (name: string, fn: () => Promise<string>) => {
        const t = Date.now();
        try { checks.push({ name, ok: true, detail: await fn(), ms: Date.now() - t }); }
        catch (e) {
          if ((e as { code?: string }).code === "SESSION_EXPIRED") kite.markExpired();
          checks.push({ name, ok: false, detail: (e as Error).message, ms: Date.now() - t });
        }
      };
      await run("Profile", async () => `user ${(await kiteData.profile(key, token)).userId ?? "unknown"}`);
      await run("Instrument list", async () => `${await kiteData.loadInstruments(key, token)} NSE equities; RELIANCE ${kiteData.instrument("RELIANCE") ? "found" : "missing"}`);
      await run("Quote RELIANCE", async () => {
        const q = await kiteData.fetchQuotes(key, token, ["NSE:RELIANCE"]);
        const v = q["NSE:RELIANCE"];
        if (!v) throw new Error("No quote in Kite's response");
        return `last ${v.last}, previous close ${v.prevClose}`;
      });
      await run("1-minute history RELIANCE (1 day)", async () => {
        const o = await kiteData.fetchCandles(key, token, "RELIANCE", "1", 1);
        return `${o.candles.length} candles, ${o.skipped} skipped`;
      });
      await run("Index history NIFTY 50 (1 day)", async () => {
        if (!kiteData.indexInstrument("NIFTY 50")) await kiteData.loadInstruments(key, token);
        const o = await kiteData.fetchIndexCandles(key, token, "NIFTY 50", "5", 1);
        return `${o.candles.length} candles`;
      });
      res.json({ connected: kite.status().connected, checks, note: "Each check calls Kite once. A failure shows Kite's own reason." });
    } catch (e) { next(e); }
  });

  r.get("/candles/:symbol", (req, res) => {
    const symbol = symbolParam.parse(req.params.symbol);
    requireKnown(symbol);
    const q = z.object({ interval: z.enum(INTERVAL_MINUTES).default("1"), days: z.coerce.number().int().min(1).max(60).default(20) }).parse(req.query);
    const base = bars(symbol, q.days);
    const out = q.interval === "1" ? base : aggregate(base, 1, Number(q.interval));
    res.json({ source: src(), symbol, interval: Number(q.interval), count: out.length, candles: out.slice(-500) });
  });

  r.get("/analysis/:symbol", (req, res) => {
    const symbol = symbolParam.parse(req.params.symbol);
    requireKnown(symbol);
    const candles = bars(symbol);
    const S = computeSeries(candles, activeCfg());
    const ev = evaluateLong(S, candles.length - 1, activeCfg(), { complete: true });
    res.json({ source: src(), symbol, asOf: new Date(candles.at(-1)!.time).toISOString(), evaluation: ev, labels: CONDITION_LABELS });
  });

  const groupSchema = z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]{1,30}$/),
    op: z.enum(["AND", "OR"]),
    members: z.array(z.enum(CONDITION_IDS)).min(1).max(CONDITION_IDS.length),
  })).max(5).refine((gs) => new Set(gs.map((g) => g.id)).size === gs.length, { message: "Group ids must be unique" })
    .refine((gs) => gs.every((g) => new Set(g.members).size === g.members.length), { message: "A group cannot repeat a condition" })
    .refine((gs) => gs.every((g) => g.members.every((m) => m !== "dataSufficiency" && m !== "riskPlan")), { message: "Data sufficiency and risk plan always apply and cannot be grouped" })
    .refine((gs) => { const all = gs.flatMap((g) => g.members); return new Set(all).size === all.length; }, { message: "A condition can belong to only one group" });

  const overrideSchema = z.object({
    conditions: z.record(z.enum(CONDITION_IDS), z.object({ enabled: z.boolean(), mandatory: z.boolean() })).optional(),
    groups: groupSchema.optional(),
    rsiMin: z.number().min(0).max(100).optional(),
    rsiMax: z.number().min(0).max(100).optional(),
    minRelativeVolume: z.number().min(0).max(20).optional(),
    minAdx: z.number().min(0).max(100).optional(),
  }).refine((o) => o.rsiMin == null || o.rsiMax == null || o.rsiMin <= o.rsiMax, { message: "rsiMin must not exceed rsiMax" });

  /** One scanner row for a symbol. Shared by the scanner and the watchlist overview. */
  const scanRow = (s: string, intervalStr: string, cfg: typeof EMA_MOMENTUM_PRO) => {
      requireKnown(s);
      const base = bars(s);
      const candles = intervalStr === "1" ? base : aggregate(base, 1, Number(intervalStr));
      const S = computeSeries(candles, cfg);
      const last = candles.length - 1;
      const ev = evaluateLong(S, last, cfg, { complete: true });
      // Previous session close for the change %; falls back to the first bar if all bars are one session.
      const dayOf = (i: number) => istParts(candles[i].time).dayKey;
      let prev = -1;
      for (let j = last; j >= 0; j--) if (dayOf(j) !== dayOf(last)) { prev = j; break; }
      const refClose = prev >= 0 ? candles[prev].close : candles[0].open;
      const price = candles[last].close;
      const trendEma = S.trend[last];
      const fast = S.fast[last], slow = S.slow[last];
      const m = S.macd[last], sig = S.macdSignal[last];
      return {
        symbol: s, signal: ev.signal, failedMandatory: ev.failedMandatory, passedChecks: ev.checks.filter((c) => c.pass === true).length, totalChecks: ev.checks.filter((c) => c.enabled).length, plan: ev.plan,
        price: round2(price),
        changePct: refClose ? round2(((price - refClose) / refClose) * 100) : null,
        trend: trendEma == null ? null : price > trendEma ? "Bullish" : "Bearish",
        emaStatus: fast == null || slow == null ? null : fast > slow ? "EMA20 > EMA50" : "EMA20 < EMA50",
        rsi: S.rsi[last] == null ? null : round2(S.rsi[last]!),
        macd: m == null || sig == null ? null : round2(m - sig),
        adx: S.adx[last] == null ? null : round2(S.adx[last]!),
        relVolume: relativeVolume(S.volumes, last, EMA_MOMENTUM_PRO.volumePeriod) == null ? null : round2(relativeVolume(S.volumes, last, EMA_MOMENTUM_PRO.volumePeriod)!),
      };
  };

  const INDICATORS = ["close", "ema20", "ema50", "ema200", "rsi14", "macd", "macdSignal", "adx14", "atr14", "relVolume", "bbUpper", "bbLower"] as const;
  const ruleSchema = z.object({
    left: z.enum(INDICATORS),
    op: z.enum([">", "<", ">=", "<="]),
    right: z.union([z.object({ type: z.literal("value"), value: z.number() }), z.object({ type: z.literal("indicator"), name: z.enum(INDICATORS) })]),
  });
  /** Indicator values on the last bar of a candle series (null when not enough history). */
  const indicatorsNow = (candles: Candle[]): Record<(typeof INDICATORS)[number], number | null> => {
    const closes = candles.map((c) => c.close);
    const i = candles.length - 1;
    const m = macd(closes), bb = bollinger(closes, 20, 2);
    return {
      close: closes[i], ema20: last(ema(closes, 20)), ema50: last(ema(closes, 50)), ema200: last(ema(closes, 200)),
      rsi14: last(rsi(closes, 14)), macd: last(m.macd), macdSignal: last(m.signal), adx14: last(adx(candles, 14).adx),
      atr14: last(atr(candles, 14)), relVolume: relativeVolume(candles.map((c) => c.volume), i, 20, true),
      bbUpper: last(bb.upper), bbLower: last(bb.lower),
    };
  };
  const OPS: Record<string, (a: number, b: number) => boolean> = { ">": (a, b) => a > b, "<": (a, b) => a < b, ">=": (a, b) => a >= b, "<=": (a, b) => a <= b };
  const candlesFor = (symbol: string, intervalStr: string) => {
    const base = bars(symbol);
    return intervalStr === "1" ? base : aggregate(base, 1, Number(intervalStr));
  };

  r.post("/scanner/run", (req, res) => {
    const body = z.object({
      universe: z.enum(["SAMPLE_STOCKS", "CUSTOM"]).default("SAMPLE_STOCKS"),
      symbols: z.array(symbolParam).max(50).optional(),
      interval: z.enum(INTERVAL_MINUTES).default("5"),
      config: overrideSchema.optional(),
      customRules: z.array(ruleSchema).max(10).optional(),
      customMatch: z.enum(["all", "any"]).default("all"),
    }).refine((b) => b.universe !== "CUSTOM" || (b.symbols?.length ?? 0) > 0, { message: "Custom universe needs at least one symbol" }).parse(req.body ?? {});
    const cfg = applyOverrides(activeCfg(), body.config ?? {});
    const symbols = body.universe === "CUSTOM" ? (body.symbols ?? []) : SAMPLE_INSTRUMENTS.map((i) => i.symbol);
    const rules = body.customRules ?? [];
    const all = symbols.map((sym) => {
      const row = scanRow(sym, body.interval, cfg);
      const values = indicatorsNow(candlesFor(sym, body.interval));
      const preview = { close: values.close, rsi14: values.rsi14, adx14: values.adx14, relVolume: values.relVolume, ema20: values.ema20, ema50: values.ema50 };
      if (!rules.length) return { ...row, preview };
      const details = rules.map((rule) => {
        const left = values[rule.left];
        const right = rule.right.type === "value" ? rule.right.value : values[rule.right.name];
        const label = `${rule.left} ${rule.op} ${rule.right.type === "value" ? rule.right.value : rule.right.name}`;
        if (left == null || right == null) return { label, pass: false, detail: "not enough history" };
        const pass = OPS[rule.op](left, right);
        return { label, pass, detail: `${fmtNum(left, 2)} vs ${fmtNum(right, 2)}` };
      });
      const pass = body.customMatch === "any" ? details.some((d) => d.pass) : details.every((d) => d.pass);
      return { ...row, preview, custom: { pass, details } };
    });
    const results = rules.length ? all.filter((r) => "custom" in r && r.custom.pass) : all;
    res.json({
      source: src(), universe: body.universe, interval: Number(body.interval),
      appliedConfig: { conditions: cfg.conditions, rsiMin: cfg.rsiMin, rsiMax: cfg.rsiMax, minRelativeVolume: cfg.minRelativeVolume, minAdx: cfg.minAdx },
      customRules: rules, customMatch: body.customMatch, customApplied: rules.length > 0, scanned: symbols.length, count: results.length,
      results: results.sort((a, b) => Number(b.signal === "BUY") - Number(a.signal === "BUY")),
    });
  });
  // ---- Full NSE scan: one background job, started by a button. Uses live Kite 1-minute history. ----
  const scanJobs = new ScanJobs();
  const scanNote = "Full NSE scan on live Kite 1-minute history (last 60 sessions). A snapshot from the time it ran, not a live feed. Not a recommendation.";
  r.get("/scanner/scan-all", (_req, res) => {
    const token = kite.accessToken();
    res.json({
      kiteConnected: Boolean(token), universeSize: kiteData.instrumentCount, job: scanJobs.state, note: scanNote,
    });
  });
  r.post("/scanner/scan-all", admin, (req, res) => {
    const body = z.object({ interval: z.enum(INTERVAL_MINUTES).default("5") }).parse(req.body ?? {});
    const token = kite.accessToken();
    if (!token || !env.KITE_API_KEY) throw new AppError(409, "KITE_NOT_CONNECTED", "Log in to Kite first. The full scan needs live data.");
    if (kiteData.instrumentCount === 0) throw new AppError(409, "UNIVERSE_NOT_LOADED", "The NSE stock list is not loaded yet. Log in to Kite again.");
    if (scanJobs.running) throw new AppError(409, "SCAN_RUNNING", "A full scan is already running.");
    const cfg = activeCfg();
    const symbols = kiteData.allInstruments().map((i) => i.symbol);
    const job = scanJobs.start(symbols, body.interval, async (sym) => {
      let out;
      try {
        out = await kiteData.fetchCandles(env.KITE_API_KEY!, token, sym, "1", 60);
      } catch (e) {
        if ((e as { code?: string }).code === "SESSION_EXPIRED") {
          kite.markExpired();
          throw Object.assign(new Error("Kite session expired during the scan"), { fatal: true });
        }
        throw e;
      }
      const base = out.candles;
      const candles = body.interval === "1" ? base : aggregate(base, 1, Number(body.interval));
      if (candles.length < 30) return null;
      const last = candles.length - 1;
      const values = indicatorsNow(candles);
      const ev = evaluateLong(computeSeries(candles, cfg), last, cfg, { complete: true });
      return { symbol: sym, signal: ev.signal, close: round2(candles[last].close), rsi14: values.rsi14 == null ? null : round2(values.rsi14), adx14: values.adx14 == null ? null : round2(values.adx14), relVolume: values.relVolume == null ? null : round2(values.relVolume) };
    });
    if (!job) throw new AppError(409, "SCAN_RUNNING", "A full scan is already running.");
    audit.record("scanner.scan_all", "OK", `${symbols.length} symbols, ${body.interval} min`);
    res.status(202).json({ job, note: scanNote });
  });
  r.post("/scanner/scan-all/cancel", admin, (_req, res) => {
    res.json({ cancelling: scanJobs.cancel(), job: scanJobs.state });
  });

  r.get("/strategies", (_req, res) => res.json({ id: "ema-momentum-pro", name: "EMA Momentum Pro", config: activeCfg(), labels: CONDITION_LABELS, note: "Built-in rules. Overrides apply to the active strategy." }));
  r.get("/strategies/active", (_req, res) => res.json({ overrides: activeOverrides, note: "Used by the chart, watchlists, scanner and backtests. Empty means the built-in defaults." }));
  r.put("/strategies/active", admin, (req, res) => {
    activeOverrides = overrideSchema.parse(req.body ?? {});
    res.json({ ok: true, overrides: activeOverrides });
  });

  const savedScanners: { id: string; name: string; savedAt: string; universe: string; interval: string; customRules: unknown[]; customMatch: "all" | "any" }[] = [];
  r.get("/scanners", (_req, res) => res.json({ items: [...savedScanners].reverse(), note: "Saved in memory; cleared on restart." }));
  r.post("/scanners", admin, (req, res) => {
    const body = z.object({
      name: z.string().trim().min(1).max(60),
      universe: z.enum(["SAMPLE_STOCKS", "CUSTOM"]).default("SAMPLE_STOCKS"),
      interval: z.enum(INTERVAL_MINUTES).default("5"),
      customRules: z.array(ruleSchema).max(10).default([]),
      customMatch: z.enum(["all", "any"]).default("all"),
    }).parse(req.body);
    if (savedScanners.length >= 50) savedScanners.shift();
    const item = { id: `S${Date.now()}`, savedAt: new Date().toISOString(), ...body };
    savedScanners.push(item);
    audit.record("scanner.save", "OK", body.name);
    res.status(201).json(item);
  });
  r.get("/backtests", (_req, res) => res.json({ items: backtests.slice(-20) }));

  r.post("/backtests", admin, (req, res) => {
    const body = z.object({
      symbol: symbolParam,
      strategyId: z.enum(["ema-momentum-pro", ...SIMPLE_STRATEGIES.map((x) => x.id)] as [string, ...string[]]).default("ema-momentum-pro"),
      days: z.coerce.number().int().min(5).max(60).default(40),
      interval: z.enum(INTERVAL_MINUTES).default("1"),
      capital: z.number().min(10000).max(10000000).default(100000),
      productType: z.enum(["DELIVERY", "INTRADAY"]).default("DELIVERY"),
      slippageBps: z.number().min(0).max(100).default(5),
      oosFraction: z.number().min(0).max(0.5).default(0),
      folds: z.number().int().min(0).max(6).default(0),
      config: overrideSchema.optional(),
    }).parse(req.body);
    if (!isEnabled(body.strategyId)) throw new AppError(409, "STRATEGY_DISABLED", "This strategy is disabled. Enable it in Strategy Library first.");
    requireKnown(body.symbol);
    const base = bars(body.symbol, body.days);
    const candles = body.interval === "1" ? base : aggregate(base, 1, Number(body.interval));
    const opts = { productType: body.productType, slippageBps: body.slippageBps };
    const cfg = { ...applyOverrides(activeCfg(), body.config ?? {}), capital: body.capital };
    const simple = effectiveStrategy(body.strategyId);
    // Runs one candle set through the chosen strategy and returns trades, equity and bar counts.
    const runOn = (cs: Candle[]) => simple
      ? (() => {
          const g = runGeneric(body.symbol, cs, simple, { capital: body.capital, riskPerTradePct: 0.5, maxPositionPct: 25, slippageBps: body.slippageBps });
          return { bars: cs.length, signals: g.signals, skipped: typeof g.skipped === "number" ? g.skipped : (g.skipped as unknown[]).length, trades: g.trades, equity: g.equity };
        })()
      : (() => {
          const r = runBacktest(body.symbol, cs, cfg, opts);
          return { bars: r.bars, signals: r.signals, skipped: r.skipped.length, trades: r.trades, equity: r.equity };
        })();
    const run = runOn(candles);
    const strategyName = simple ? simple.name : EMA_MOMENTUM_PRO_NAME;
    const metrics = computeMetrics(run.trades, body.capital, run.equity);
    let walkForward: unknown = null;
    if (body.oosFraction > 0) {
      const { inSample, outOfSample } = splitByDay(candles, body.oosFraction);
      if (countSessions(inSample) < 5 || countSessions(outOfSample) < 3) throw new AppError(400, "NOT_ENOUGH_SESSIONS", "Need at least 5 in-sample and 3 out-of-sample sessions");
      const isRun = runOn(inSample);
      const oosRun = runOn(outOfSample);
      walkForward = {
        oosFraction: body.oosFraction,
        inSample: { bars: inSample.length, metrics: computeMetrics(isRun.trades, body.capital, isRun.equity) },
        outOfSample: { bars: outOfSample.length, metrics: computeMetrics(oosRun.trades, body.capital, oosRun.equity) },
        note: "The out-of-sample run restarts indicators, so its first sessions are warm-up. Parameters were not optimised, so this is a stability check, not a proof.",
      };
    }
    let rolling: unknown = null;
    if (body.folds >= 2) {
      // Split consecutive IST sessions into equal blocks and run the strategy on each block separately.
      const keys = [...new Set(candles.map((c) => istParts(c.time).dayKey))];
      if (keys.length < body.folds * 3) throw new AppError(400, "NOT_ENOUGH_SESSIONS", `Need at least ${body.folds * 3} sessions for ${body.folds} folds`);
      const per = Math.ceil(keys.length / body.folds);
      const rows = Array.from({ length: body.folds }, (_, f) => {
        const block = new Set(keys.slice(f * per, (f + 1) * per));
        const cs = candles.filter((c) => block.has(istParts(c.time).dayKey));
        const r = runOn(cs);
        const m = computeMetrics(r.trades, body.capital, r.equity);
        return { fold: f + 1, sessions: block.size, from: cs[0] ? new Date(cs[0].time).toISOString() : null, to: cs.at(-1) ? new Date(cs.at(-1)!.time).toISOString() : null, trades: m.trades, netProfit: m.netProfit, winRate: m.winRate };
      });
      rolling = { folds: rows, positiveFolds: rows.filter((x) => x.netProfit > 0).length, note: "Each block is run on its own, so indicators restart at each block. Parameters are not re-optimised per block. A stability check, not a proof." };
    }
    const item = { id: `B${backtests.length + 1}`, createdAt: new Date().toISOString(), source: src(), symbol: body.symbol, strategyId: body.strategyId, strategyName, interval: body.interval, capital: body.capital, bars: run.bars, signals: run.signals, skipped: run.skipped, metrics, walkForward, rolling, trades: run.trades.slice(-100), equity: run.equity.slice(-500) };
    audit.record("backtest.run", "OK", `${body.symbol} ${body.strategyId} ${body.days}d ${body.interval}m oos=${body.oosFraction}`);
    backtests.push(item);
    if (backtests.length > 20) backtests.splice(0, backtests.length - 20);
    res.status(201).json(item);
  });

  r.get("/paper", (_req, res) => res.json({ ...paper.snapshot(), note: "Paper trading only. No real orders are placed." }));
  r.get("/reports/paper", (req, res) => {
    const q = z.object({
      period: z.enum(["daily", "weekly", "monthly"]).default("daily"),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.query);
    const DAY = 86_400_000, IST = 19_800_000;
    const from = q.from ? Date.parse(`${q.from}T00:00:00Z`) - IST : undefined;
    const to = q.to ? Date.parse(`${q.to}T00:00:00Z`) - IST + DAY - 1 : undefined;
    if (from != null && to != null && from > to) throw new AppError(400, "INVALID", "from must be on or before to");
    const snap = paper.snapshot();
    res.json(buildPaperReport({
      trades: snap.trades, positions: snap.positions, startCapital: snap.startCapital,
      maxDailyLossPct: DEFAULT_RISK_LIMITS.maxDailyLossPct, period: q.period, from, to, nowMs: Date.now(),
    }));
  });

  r.post("/paper/order", admin, (req, res) => {
    const body = z.object({ symbol: symbolParam, qty: z.number().int().min(1).max(100000), stop: z.number().positive(), target: z.number().positive() }).parse(req.body);
    requireKnown(body.symbol);
    const last = bars(body.symbol, 20).at(-1)!;
    const result = paper.placeManual(body.symbol, last.close, last.time, body.qty, body.stop, body.target);
    if (!result.ok) throw new AppError(409, "ORDER_BLOCKED", result.reasons.join("; "));
    res.status(201).json(result.order);
  });
  // Checks the core five plus every stock with an open position or pending order, so stops and targets fire on any stock.
  const paperSymbols = () => [...new Set([...SAMPLE_INSTRUMENTS.map((i) => i.symbol), ...paper.activeSymbols()])];
  r.post("/paper/scan", admin, async (_req, res, next) => {
    try {
      audit.record("paper.scan");
      const symbols = paperSymbols();
      await market.loadSymbols(symbols);
      const out = symbols.map((sym) => {
        const candles = bars(sym);
        paper.onBar(sym, candles);
        const s = paper.submitSignal(sym, candles, true);
        return { symbol: sym, status: s.status, reasons: s.reasons };
      });
      res.json({ source: src(), results: out, paper: paper.snapshot() });
    } catch (e) { next(e); }
  });

  r.post("/paper/emergency-stop", admin, async (req, res, next) => {
    try {
      const body = z.object({ active: z.boolean() }).parse(req.body);
      paper.emergencyStop = body.active;
      audit.record("paper.emergency_stop", "OK", String(body.active));
      let flattened = 0;
      if (body.active) {
        // Every open position is priced from its own stock's bars, so no position closes at its entry price by accident.
        const held = paper.activeSymbols();
        await market.loadSymbols(held);
        const prices = new Map(held.map((sym) => [sym, bars(sym).at(-1)!.close]));
        flattened = paper.flatten(Date.now(), prices);
      }
      res.json({ emergencyStop: paper.emergencyStop, flattened });
    } catch (e) { next(e); }
  });

  r.post("/live/orders", (_req, res) => {
    res.status(403).json({ error: { code: "LIVE_TRADING_DISABLED", message: "Live order placement is not implemented in this version." } });
  });

  r.get("/broker/status", (_req, res) => res.json(kite.status()));

  r.get("/broker/login-url", (_req, res) => res.json({ url: kite.loginUrl(), note: "Kite endpoints are unverified; see README." }));

  r.post("/broker/session", admin, async (req, res, next) => {
    try {
      const body = z.object({ requestToken: z.string().min(8).max(200) }).parse(req.body);
      await kite.exchange(body.requestToken);
      audit.record("broker.session_exchange");
      res.status(201).json(kite.status());
    } catch (e) { next(e); }
  });

  r.delete("/broker/session", admin, (_req, res) => { kite.logout(); audit.record("broker.logout"); res.json(kite.status()); });

  /**
   * Kite redirects here after the person logs in on Zerodha's own page (password and OTP entered there).
   * The request_token is exchanged for an access token server-side; no token is shown in the URL or logged.
   */
  r.get("/broker/callback", async (req, res) => {
    const front = (path: string) => res.redirect(302, `${env.FRONTEND_URL.replace(/\/$/, "")}${path}`);
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const requestToken = typeof req.query.request_token === "string" ? req.query.request_token : "";
    if (status !== "success" || !/^[A-Za-z0-9]{8,64}$/.test(requestToken)) {
      audit.record("broker.callback", "FAILED", "login not completed");
      return front("/connection?kite=failed");
    }
    try {
      await kite.exchange(requestToken);
      audit.record("broker.callback", "OK");
      return front("/connection?kite=connected");
    } catch {
      audit.record("broker.callback", "FAILED", "exchange rejected");
      return front("/connection?kite=failed");
    }
  });

  r.get("/risk/limits", (_req, res) => {
    res.json({ limits: { ...DEFAULT_RISK_LIMITS, capital: paper.startCapital }, current: { openPositions: paper.positions.size, dailyRealizedPnl: paper.realizedPnl, emergencyStop: paper.emergencyStop } });
  });

  r.get("/audit", admin, (_req, res) => res.json({ items: audit.list(100), note: "Admin actions only. Tokens and request bodies are never recorded." }));

  const fmtNum = (v: number, d = 2) => v.toFixed(d);
  const last = (arr: (number | null | undefined)[]) => {
    for (let k = arr.length - 1; k >= 0; k--) { const v = arr[k]; if (v != null && Number.isFinite(v)) return Math.round(v * 100) / 100; }
    return null;
  };

  r.get("/indicators/:symbol", (req, res) => {
    const symbol = symbolParam.parse(req.params.symbol);
    requireKnown(symbol);
    const q = z.object({ interval: z.enum([...INTERVAL_MINUTES, "D"]).default("5") }).parse(req.query);
    const base = bars(symbol);
    const candles = q.interval === "D" ? aggregateDaily(base) : q.interval === "1" ? base : aggregate(base, 1, Number(q.interval));
    const closes = candles.map((c) => c.close);
    const m = macd(closes);
    const bb = bollinger(closes);
    const a = adx(candles);
    const e20 = last(ema(closes, 20)), e50 = last(ema(closes, 50)), e200 = last(ema(closes, 200));
    const r14 = last(rsi(closes, 14)), macdV = last(m.macd as (number | null)[]), macdS = last(m.signal as (number | null)[]);
    const rv = relativeVolume(candles.map((c) => c.volume), candles.length - 1, 20);
    const close = candles.at(-1)!.close;
    const prevDay = (() => {
      const dayOf = (i: number) => istParts(candles[i].time).dayKey;
      const lastIdx = candles.length - 1;
      for (let j = lastIdx; j >= 0; j--) if (dayOf(j) !== dayOf(lastIdx)) return candles[j].close;
      return candles[0].open;
    })();
    // Rule-based summary (not AI). Each label follows from the numbers above.
    const trend = e20 == null || e50 == null || e200 == null ? "Not enough history"
      : close > e200 && e20 > e50 ? "Bullish" : close < e200 && e20 < e50 ? "Bearish" : "Sideways";
    const momentum = r14 == null || macdV == null || macdS == null ? "Not enough history"
      : r14 >= 55 && macdV > macdS ? "Strong" : r14 <= 45 && macdV < macdS ? "Weak" : "Neutral";
    const volume = rv == null ? "Not enough history" : rv >= 1.5 ? "High" : rv < 0.7 ? "Low" : "Normal";
    const emaAlignment = e20 == null || e50 == null || e200 == null ? "Not enough history"
      : e20 > e50 && e50 > e200 ? "20 > 50 > 200 (bullish stack)" : e20 < e50 && e50 < e200 ? "20 < 50 < 200 (bearish stack)" : "Mixed";
    const levels = swingLevels(candles);
    const final = trend === "Bullish" && momentum === "Strong" && volume !== "Low"
      ? "Bullish technical picture: trend, momentum and volume agree. Not a buy recommendation."
      : trend === "Bearish" && momentum === "Weak" ? "Bearish technical picture: trend and momentum agree. Not a sell recommendation."
      : "Mixed picture: the rules do not agree. Wait for confirmation.";
    res.json({
      source: src(), symbol, interval: q.interval === "D" ? "D" : Number(q.interval), asOf: new Date(candles.at(-1)!.time).toISOString(), close: round2(close),
      changePct: prevDay ? round2(((close - prevDay) / prevDay) * 100) : null,
      values: {
        ema20: e20, ema50: e50, ema200: e200, sma50: last(sma(closes, 50)),
        rsi14: r14, macd: macdV, macdSignal: macdS,
        adx14: last(a.adx as (number | null)[]), atr14: last(atr(candles, 14)), vwap: last(vwap(candles)),
        bollingerUpper: last(bb.upper as (number | null)[]), bollingerLower: last(bb.lower as (number | null)[]),
        relativeVolume: rv,
      },
      summary: { trend, momentum, volume, emaAlignment, supportLevels: levels.support, resistanceLevels: levels.resistance, final },
      note: "Last value of each indicator on SAMPLE bars. null means not enough history. The summary is rule-based and is not AI.",
    });
  });

  r.get("/mtf/:symbol", (req, res) => {
    const symbol = symbolParam.parse(req.params.symbol);
    requireKnown(symbol);
    const TF = ["1", "3", "5", "10", "15", "30", "60", "240", "D"] as const;
    // About 340 calendar days (roughly 235 sessions) so the daily frame has enough bars for the 200 EMA.
    const base = bars(symbol, 340);
    const daily = market.dailyBars(symbol, 340);
    const cfg = activeCfg();
    const frames = TF.map((iv) => {
      const cs = iv === "D" ? daily : iv === "1" ? base : aggregate(base, 1, Number(iv));
      const closes = cs.map((c) => c.close);
      const last = cs.length - 1;
      const e20 = last >= 0 ? ema(closes, 20)[last] : null;
      const e50 = last >= 0 ? ema(closes, 50)[last] : null;
      const e200 = last >= 0 ? ema(closes, 200)[last] : null;
      const r14 = last >= 0 ? rsi(closes, 14)[last] : null;
      const m = last >= 0 ? macd(closes, 12, 26, 9) : null;
      const macdLine = m ? m.macd[last] : null;
      const macdSig = m ? m.signal[last] : null;
      const adxVal = last >= 0 ? adx(cs, 14).adx[last] : null;
      const rv = last >= 0 ? relativeVolume(cs.map((c) => c.volume), last, 20) : null;
      const close = cs.at(-1)?.close ?? null;
      const trend = e20 == null || e50 == null || e200 == null || close == null ? "Unknown"
        : e20 > e50 && close > e200 ? "Bullish" : e20 < e50 && close < e200 ? "Bearish" : "Sideways";
      const emaAlignment = e20 == null || e50 == null || e200 == null ? "Unknown"
        : e20 > e50 && e50 > e200 ? "Bullish stack" : e20 < e50 && e50 < e200 ? "Bearish stack" : "Mixed";
      const signal = cs.length >= 2 ? evaluateLong(computeSeries(cs, cfg), last, cfg, { complete: true }).signal : "WAIT";
      return {
        timeframe: iv, bars: cs.length, close, ema20: e20, ema50: e50, ema200: e200, rsi14: r14,
        macd: macdLine, macdSignal: macdSig, adx14: adxVal, relVolume: rv == null ? null : round2(rv),
        trend, emaAlignment, signal,
        historyEnough: e200 != null,
      };
    });
    const decided = frames.filter((f) => f.trend !== "Unknown");
    const count = (pred: (f: (typeof frames)[number]) => boolean) => frames.filter(pred).length;
    const bull = count((f) => f.trend === "Bullish"), bear = count((f) => f.trend === "Bearish");
    const majority = bull > bear ? "Bullish" : bear > bull ? "Bearish" : "Sideways";
    const agreeing = count((f) => f.trend === majority);
    const summary = {
      trendScore: decided.length ? round2(((bull - bear) / decided.length) * 100) : null,
      bullishFrames: bull, bearishFrames: bear, decidedFrames: decided.length, totalFrames: frames.length,
      agreement: decided.length ? round2((agreeing / frames.length) * 100) : null,
      majorityTrend: majority,
      buySignals: count((f) => f.signal === "BUY"),
      finalSignal: decided.length < 5 ? "Not enough history on most timeframes" : agreeing >= 7 && majority !== "Sideways"
        ? `${majority} alignment on ${agreeing} of ${frames.length} timeframes` : "Mixed: no confirmed alignment",
    };
    res.json({ source: src(), symbol, frames, summary, note: `Values are calculated from ${src()} candles. Daily values need about 200 sessions of history, so they show as unknown here. Not a recommendation.` });
  });

  r.get("/data/quality/:symbol", (req, res) => {
    const symbol = symbolParam.parse(req.params.symbol);
    requireKnown(symbol);
    const raw = bars(symbol, 20);
    const rep = sanitizeCandles(raw);
    const reasons: Record<string, number> = {};
    for (const d of rep.dropped) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
    res.json({
      source: src(), symbol, received: raw.length, kept: rep.candles.length, dropped: rep.dropped.length, duplicates: rep.duplicates,
      droppedByReason: reasons, sufficientForStrategy: rep.candles.length >= 250,
      lastBar: rep.candles.length ? new Date(rep.candles.at(-1)!.time).toISOString() : null,
    });
  });

  r.get("/live/status", (_req, res) => {
    const p = istParts(Date.now());
    res.json({
      enabled: false, implemented: false,
      gates: [
        { id: "broker", label: "Broker authentication succeeded", ok: kite.status().connected },
        { id: "data", label: "Valid market data", ok: false, detail: "No real market-data feed is connected (SAMPLE only)" },
        { id: "risk", label: "Risk settings configured", ok: true },
        { id: "permission", label: "Trading permission verified", ok: false, detail: "Not implemented" },
        { id: "explicit", label: "User explicitly enabled live trading", ok: false, detail: "Live trading is not implemented in this version" },
        { id: "hours", label: "Within NSE session", ok: p.weekday >= 1 && p.weekday <= 5 && p.minutes >= 555 && p.minutes < 930 },
      ],
      note: "Live order placement is disabled. Every gate must pass before it could ever be enabled.",
    });
  });

  r.get("/market/overview", (_req, res) => {
    const items = SAMPLE_INSTRUMENTS.map((i) => {
      const cs = bars(i.symbol, 2);
      const last = cs.at(-1)!;
      const todayStart = last.time - (last.time % 86_400_000);
      const prevClose = cs.filter((c) => c.time < todayStart).at(-1)?.close ?? cs[0]?.open ?? last.close;
      const todayVol = cs.filter((c) => c.time >= todayStart).reduce((s, c) => s + c.volume, 0);
      return { symbol: i.symbol, name: i.name, last: last.close, changePct: Math.round(((last.close - prevClose) / prevClose) * 10000) / 100, volume: todayVol };
    });
    res.json({ source: src(), items, note: "Change is versus the previous session's last close in SAMPLE data." });
  });

  r.get("/journal", (_req, res) => {
    const items = paper.trades.map((t) => {
      const key = `${t.symbol}:${t.exitTime}`;
      const saved = journalNotes.get(key);
      return { key, ...t, note: saved?.note ?? "", noteAt: saved ? saved.at : null };
    });
    res.json({ items: items.slice(-200).reverse(), note: "Notes are kept in memory and reset on restart." });
  });

  r.put("/journal/note", admin, (req, res) => {
    const body = z.object({ key: z.string().regex(/^[A-Z0-9&-]{1,20}:\d+$/), note: z.string().max(500) }).parse(req.body);
    if (!paper.trades.some((t) => `${t.symbol}:${t.exitTime}` === body.key)) throw new AppError(404, "NOT_FOUND", "No paper trade with that key");
    if (!journalNotes.has(body.key) && journalNotes.size >= 1000) throw new AppError(409, "LIMIT", "Journal note limit reached");
    journalNotes.set(body.key, { note: body.note.trim(), at: Date.now() });
    audit.record("journal.note", "OK", body.key.split(":")[0]);
    res.json({ key: body.key, note: body.note.trim(), noteAt: journalNotes.get(body.key)!.at });
  });

  // Rule-based analysis of the SAMPLE bars. Every number comes from the indicators; nothing is predicted.
  const buildAnalysis = (symbol: string) => {
    const candles = bars(symbol);
    const closes = candles.map((c) => c.close);
    const S = computeSeries(candles, activeCfg());
    const i = candles.length - 1;
    const ev = evaluateLong(S, i, activeCfg(), { complete: true });
    const price = candles[i].close;
    const e20 = last(ema(closes, 20)), e50 = last(ema(closes, 50)), e200 = last(ema(closes, 200));
    const r14 = last(rsi(closes, 14));
    const m = macd(closes), mLine = last(m.macd), mSig = last(m.signal);
    const adxV = last(adx(candles, 14).adx);
    const atrV = last(atr(candles, 14));
    const bb = bollinger(closes, 20, 2), bbU = last(bb.upper), bbL = last(bb.lower);
    const rv = relativeVolume(candles.map((c) => c.volume), i, 20, true);
    const recent = candles.slice(-20);
    const support = round2(Math.min(...recent.map((c) => c.low))), resistance = round2(Math.max(...recent.map((c) => c.high)));
    const failed = ev.checks.filter((c) => c.enabled && c.pass === false).map((c) => c.label);
    const plan = ev.plan;

    const trendLabel = e20 == null || e50 == null ? "Not enough history" : e20 > e50 ? (e200 != null && price > e200 ? "Uptrend" : "Uptrend, weaker") : e200 != null && price < e200 ? "Downtrend" : "Downtrend, weaker";
    const trend = { title: "Trend", value: trendLabel, detail: e20 != null && e50 != null ? `EMA20 ${fmtNum(e20)} vs EMA50 ${fmtNum(e50)}${e200 != null ? `; price ${price > e200 ? "above" : "below"} EMA200 ${fmtNum(e200)}` : ""}.` : "Need more bars for the moving averages." };
    const rsiLabel = r14 == null ? "n/a" : r14 > 70 ? "Overbought" : r14 < 30 ? "Oversold" : "Neutral";
    const momentum = { title: "Momentum", value: r14 == null ? "n/a" : `RSI ${fmtNum(r14, 1)} · ${rsiLabel}`, detail: `MACD ${mLine != null && mSig != null && mLine > mSig ? "above" : "below"} its signal line; ADX ${adxV == null ? "n/a" : fmtNum(adxV, 1)} (${adxV != null && adxV >= 20 ? "trend strength present" : "weak or no clear trend"}).` };
    const band = bbU != null && bbL != null ? (price >= bbU ? "at or above the upper band" : price <= bbL ? "at or below the lower band" : "inside the bands") : "n/a";
    const volatility = { title: "Volatility", value: atrV == null ? "n/a" : `ATR ${fmtNum(atrV)} (${fmtNum((atrV / price) * 100)}% of price)`, detail: `Price is ${band} (Bollinger 20, 2).` };
    const volume = { title: "Volume", value: rv == null ? "n/a" : `${fmtNum(rv)}× the 20-bar average`, detail: rv != null && rv >= 1.5 ? "Participation is above average, which supports a move." : "Participation is normal or below average." };
    const signal = { title: "Scanner signal", value: ev.signal === "BUY" ? "BUY" : "WAIT", detail: ev.signal === "BUY" ? "All mandatory strategy conditions pass on the latest closed bar." : `Failing conditions: ${failed.length ? failed.join("; ") : "none listed"}.` };
    const cards = [trend, momentum, volatility, volume, signal];

    const scenarios = [
      { title: "Bullish case", text: `If price closes above ${fmtNum(resistance)} (the 20-bar high) with RSI below 70, the upward view gains support.${plan ? ` A long plan on this bar would target ${fmtNum(plan.target)} with a stop at ${fmtNum(plan.stop)}.` : ""}` },
      { title: "Bearish case", text: `If price closes below ${fmtNum(support)} (the 20-bar low), the short-term structure weakens and the uptrend view should be dropped.` },
    ];
    const risks = [
      "SAMPLE generated data, not real NSE prices. Do not treat these levels as market levels.",
      atrV != null ? `A stop 2 ATR below entry is about ${fmtNum(2 * atrV)} per share on this stock.` : "ATR is not available yet.",
      "Indicators lag price. Signals can reverse within a few bars.",
      "Rule-based summary, not a forecast or investment advice. No orders are placed.",
    ];
    const questions = [
      { q: "Is the trend up?", a: `${trend.value}. ${trend.detail}` },
      { q: "Is the stock overbought or oversold?", a: `${momentum.value}. ${momentum.detail}` },
      { q: "Is volume confirming the move?", a: `${volume.value}. ${volume.detail}` },
      { q: "Why is the scanner not showing BUY?", a: signal.detail },
      { q: "What would invalidate this view?", a: `A close below ${fmtNum(support)}, the 20-bar low, would break the current range.` },
    ];
    const lines = [trend.detail, `${momentum.value}. ${momentum.detail}`, signal.detail];
    return {
      source: src(), symbol, asOf: new Date(candles[i].time).toISOString(), method: "rule-based", price: round2(price),
      levels: { support, resistance }, cards, scenarios, risks, questions, summary: lines,
      disclaimer: "Rule-based summary of indicator values on SAMPLE data. It is not AI analysis, not a forecast and not investment advice.",
    };
  };
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const savedAnalyses: { id: string; savedAt: string; result: ReturnType<typeof buildAnalysis> }[] = [];

  r.get("/analyst/:symbol", (req, res) => {
    const symbol = symbolParam.parse(req.params.symbol);
    requireKnown(symbol);
    res.json(buildAnalysis(symbol));
  });
  r.post("/analyst/ask", admin, (req, res, next) => {
    try {
      const body = z.object({ symbol: z.string().min(1).max(20), question: z.string().min(1).max(MAX_QUESTION) }).parse(req.body);
      const symbol = symbolParam.parse(body.symbol);
      requireKnown(symbol);
      const a = buildAnalysis(symbol);
      const rule = () => { const r0 = ruleAnswer(a, body.question); res.json({ symbol, question: body.question, source: "rule-based", topic: r0.topic, answer: r0.answer, disclaimer: a.disclaimer }); };
      if (!env.ANTHROPIC_API_KEY) return rule();
      llmAnswer(a, body.question, env.ANTHROPIC_API_KEY).then((text) => {
        if (text) res.json({ symbol, question: body.question, source: "language model", answer: text, disclaimer: a.disclaimer });
        else rule();
      }, next);
    } catch (e) {
      next(e);
    }
  });
  r.get("/analyst/saved/list", (_req, res) => res.json({ items: [...savedAnalyses].reverse(), note: "Saved in memory; cleared on restart." }));
  r.post("/analyst/saved", admin, (req, res) => {
    const symbol = symbolParam.parse(z.object({ symbol: z.string() }).parse(req.body).symbol);
    requireKnown(symbol);
    if (savedAnalyses.length >= 50) savedAnalyses.shift();
    const item = { id: `A${savedAnalyses.length + 1}-${Date.now()}`, savedAt: new Date().toISOString(), result: buildAnalysis(symbol) };
    savedAnalyses.push(item);
    res.status(201).json(item);
  });

  // Live Kite candles when a session is active. Kite supports 1, 5, 15, 60 minute and daily; other intervals stay on SAMPLE.
  const chartNote = () => market.live ? "Live Kite data. Built from 1-minute bars for the last 60 sessions." : (market.lastError ?? "SAMPLE data. Log in to Kite to load live bars.");
  r.get("/chart/:symbol", async (req, res, next) => {
    try {
    const sym = symbolParam.parse(req.params.symbol);
    requireKnown(sym);
    const q = z.object({ interval: z.enum([...INTERVAL_MINUTES, "D"]).default("5"), days: z.coerce.number().int().min(2).max(60).default(20) }).parse(req.query);
    // Live Kite bars when the session is loaded; otherwise SAMPLE. Every interval is built from the same 1-minute bars.
    const base = bars(sym, q.days);
    const cs = q.interval === "D" ? market.dailyBars(sym, q.days) : q.interval === "1" ? base : aggregate(base, 1, Number(q.interval));
    const closes = cs.map((c) => c.close);
    const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200), r14 = rsi(closes, 14);
    const volAvg20 = sma(cs.map((c) => c.volume), 20);
    const adx14Arr = adx(cs, 14).adx;
    const atr14Arr = atr(cs, 14);
    const S = computeSeries(cs, activeCfg());
    const ev = evaluateLong(S, cs.length - 1, activeCfg(), { complete: true });
    const plan = ev.plan ? {
      entry: ev.plan.entry, stop: ev.plan.stop, target1: ev.plan.target,
      target2: Math.round((ev.plan.entry + (activeCfg().targetR + 1) * ev.plan.riskPerShare) * 100) / 100,
      riskPerShare: ev.plan.riskPerShare, qty: ev.plan.qty, rewardToRisk: ev.plan.rewardToRisk,
    } : null;
    // Buy markers for the bars shown: bars where the scanner rule would have said BUY (sample data, not advice).
    const shownFrom = Math.max(0, cs.length - 300);
    const markers: { time: number; price: number; side: "BUY" }[] = [];
    for (let i = shownFrom; i < cs.length; i++) {
      if (evaluateLong(S, i, activeCfg(), { complete: true }).signal === "BUY") markers.push({ time: cs[i].time, price: cs[i].low, side: "BUY" });
    }
    const setup = {
      signal: ev.signal,
      passedChecks: ev.checks.filter((c) => c.pass === true).length,
      totalChecks: ev.checks.filter((c) => c.enabled).length,
      checks: ev.checks.filter((c) => c.enabled).map((c) => ({ label: c.label, mandatory: c.mandatory, pass: c.pass, detail: c.detail })),
      plan,
      reason: plan ? null : (ev.signal === "BUY" ? null : "No BUY on the last bar; see checks"),
    };
    const m = macd(closes);
    const keep = cs.slice(-300);
    const tail = (arr: (number | null)[]) => arr.slice(-300);
    res.json({
      source: src(), note: chartNote(), symbol: sym, interval: q.interval === "D" ? "D" : Number(q.interval),
      candles: keep,
      markers,
      levels: swingLevels(cs),
      ema20: tail(e20), ema50: tail(e50), ema200: tail(e200), rsi14: tail(r14),
      volume: keep.map((c) => c.volume), volumeAvg20: tail(volAvg20 as (number | null)[]),
      adx14: tail(adx14Arr as (number | null)[]), atr14: tail(atr14Arr as (number | null)[]),
      setup,
      macd: tail(m.macd as (number | null)[]), macdSignal: tail(m.signal as (number | null)[]),
    });
    } catch (e) { next(e); }
  });

  r.get("/watchlists", (_req, res) => res.json({ items: [...watchlists].map(([name, symbols]) => ({ name, symbols })) }));

  r.get("/watchlists/:name/overview", (req, res) => {
    const name = z.string().regex(/^[a-z0-9-]{1,30}$/).parse(req.params.name);
    const q = z.object({ interval: z.enum([...INTERVAL_MINUTES]).default("5") }).parse(req.query);
    const symbols = watchlists.get(name);
    if (!symbols) throw new AppError(404, "NOT_FOUND", "No watchlist with that name");
    const items = symbols.map((sym) => scanRow(sym, q.interval, activeCfg()));
    res.json({ source: src(), name, interval: Number(q.interval), items, note: "SAMPLE data. Signals use the default EMA Momentum Pro rules. Not a recommendation." });
  });

  r.put("/watchlists/:name", admin, (req, res) => {
    const name = z.string().regex(/^[a-z0-9-]{1,30}$/).parse(req.params.name);
    const symbols = z.array(symbolParam).max(50).parse(req.body?.symbols ?? []);
    symbols.forEach(requireKnown);
    if (!watchlists.has(name) && watchlists.size >= 20) throw new AppError(409, "LIMIT", "Maximum 20 watchlists");
    watchlists.set(name, symbols);
    audit.record("watchlist.update", "OK", name);
    res.json({ name, symbols });
  });

  return r;
}
