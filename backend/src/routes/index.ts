import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { aggregate, istParts, sanitizeCandles, type Candle } from "../domain/candles.js";
import { adx, atr, bollinger, ema, macd, rsi, sma, vwap } from "../indicators/index.js";
import { sampleCandles, SAMPLE_INSTRUMENTS } from "../data/sample.js";
import { runBacktest, splitByDay } from "../backtest/engine.js";
import { DEFAULT_RISK_LIMITS } from "../risk/risk-manager.js";
import type { AuditLog } from "../audit/log.js";
import { computeMetrics } from "../backtest/metrics.js";
import { CONDITION_IDS, CONDITION_LABELS, EMA_MOMENTUM_PRO, computeSeries, evaluateLong } from "../strategy/ema-momentum-pro.js";
import { PaperEngine } from "../paper/engine.js";
import { KiteService } from "../broker/kite.js";
import { AppError } from "../utils/errors.js";
import { requireAdmin } from "./middleware.js";

export interface Deps { env: Env; paper: PaperEngine; kite: KiteService; audit: AuditLog }

const symbolParam = z.string().regex(/^[A-Z0-9&-]{1,20}$/);
const SAMPLE_NOTE = "All market data here is SAMPLE (generated), not real NSE data.";

export function createRouter({ env, paper, kite, audit }: Deps): Router {
  const r = Router();
  const cache = new Map<string, Candle[]>();
  const bars = (symbol: string, days = 30): Candle[] => {
    const key = `${symbol}:${days}`;
    let c = cache.get(key);
    if (!c) {
      const base = SAMPLE_INSTRUMENTS.find((i) => i.symbol === symbol)?.basePrice ?? 1000;
      c = sampleCandles(symbol, days, base);
      cache.set(key, c);
    }
    return c;
  };
  const requireKnown = (symbol: string) => {
    if (!SAMPLE_INSTRUMENTS.some((i) => i.symbol === symbol)) throw new AppError(404, "UNKNOWN_SYMBOL", `${symbol} is not in the sample instrument list`);
  };
  const admin = requireAdmin(env.ADMIN_TOKEN);
  const backtests: unknown[] = [];
  const journalNotes = new Map<string, string>();
  const watchlists = new Map<string, string[]>([["default", ["RELIANCE", "TCS", "INFY"]]]);

  r.get("/status", (_req, res) => {
    const p = istParts(Date.now());
    const open = p.weekday >= 1 && p.weekday <= 5 && p.minutes >= 555 && p.minutes < 930;
    res.json({ mode: "PAPER", dataSource: "SAMPLE", liveTrading: "NOT_IMPLEMENTED", marketOpen: open, kite: kite.status(), serverTime: new Date().toISOString(), note: SAMPLE_NOTE });
  });

  r.get("/market/status", (_req, res) => {
    const p = istParts(Date.now());
    const weekday = p.weekday >= 1 && p.weekday <= 5;
    res.json({ timezone: "Asia/Kolkata", session: "09:15–15:30 IST, Mon–Fri", open: weekday && p.minutes >= 555 && p.minutes < 930, holidayCalendar: "NOT_LOADED" });
  });

  r.get("/instruments", (_req, res) => res.json({ source: "SAMPLE", items: SAMPLE_INSTRUMENTS }));

  r.get("/candles/:symbol", (req, res) => {
    const symbol = symbolParam.parse(req.params.symbol);
    requireKnown(symbol);
    const q = z.object({ interval: z.enum(["1", "5", "15"]).default("1"), days: z.coerce.number().int().min(1).max(60).default(20) }).parse(req.query);
    const base = bars(symbol, q.days);
    const out = q.interval === "1" ? base : aggregate(base, 1, Number(q.interval));
    res.json({ source: "SAMPLE", symbol, interval: Number(q.interval), count: out.length, candles: out.slice(-500) });
  });

  r.get("/analysis/:symbol", (req, res) => {
    const symbol = symbolParam.parse(req.params.symbol);
    requireKnown(symbol);
    const candles = bars(symbol);
    const S = computeSeries(candles, EMA_MOMENTUM_PRO);
    const ev = evaluateLong(S, candles.length - 1, EMA_MOMENTUM_PRO, { complete: true });
    res.json({ source: "SAMPLE", symbol, asOf: new Date(candles.at(-1)!.time).toISOString(), evaluation: ev, labels: CONDITION_LABELS });
  });

  const overrideSchema = z.object({
    conditions: z.record(z.enum(CONDITION_IDS), z.object({ enabled: z.boolean(), mandatory: z.boolean() })).optional(),
    rsiMin: z.number().min(0).max(100).optional(),
    rsiMax: z.number().min(0).max(100).optional(),
    minRelativeVolume: z.number().min(0).max(20).optional(),
    minAdx: z.number().min(0).max(100).optional(),
  }).refine((o) => o.rsiMin == null || o.rsiMax == null || o.rsiMin <= o.rsiMax, { message: "rsiMin must not exceed rsiMax" });

  r.post("/scanner/run", (req, res) => {
    const body = z.object({ symbols: z.array(symbolParam).max(50).optional(), config: overrideSchema.optional() }).parse(req.body ?? {});
    const cfg = {
      ...EMA_MOMENTUM_PRO,
      ...(body.config?.rsiMin != null ? { rsiMin: body.config.rsiMin } : {}),
      ...(body.config?.rsiMax != null ? { rsiMax: body.config.rsiMax } : {}),
      ...(body.config?.minRelativeVolume != null ? { minRelativeVolume: body.config.minRelativeVolume } : {}),
      ...(body.config?.minAdx != null ? { minAdx: body.config.minAdx } : {}),
      conditions: { ...EMA_MOMENTUM_PRO.conditions, ...(body.config?.conditions ?? {}) },
    };
    const symbols = body.symbols ?? SAMPLE_INSTRUMENTS.map((i) => i.symbol);
    const results = symbols.map((s) => {
      requireKnown(s);
      const candles = bars(s);
      const S = computeSeries(candles, cfg);
      const ev = evaluateLong(S, candles.length - 1, cfg, { complete: true });
      return { symbol: s, signal: ev.signal, failedMandatory: ev.failedMandatory, passedChecks: ev.checks.filter((c) => c.pass === true).length, totalChecks: ev.checks.filter((c) => c.enabled).length, plan: ev.plan };
    });
    res.json({ source: "SAMPLE", appliedConfig: { conditions: cfg.conditions, rsiMin: cfg.rsiMin, rsiMax: cfg.rsiMax, minRelativeVolume: cfg.minRelativeVolume, minAdx: cfg.minAdx }, count: results.length, results: results.sort((a, b) => Number(b.signal === "BUY") - Number(a.signal === "BUY")) });
  });

  r.get("/strategies", (_req, res) => res.json({ id: "ema-momentum-pro", name: "EMA Momentum Pro", config: EMA_MOMENTUM_PRO, labels: CONDITION_LABELS, note: "Built-in, read-only in this version." }));

  r.get("/backtests", (_req, res) => res.json({ items: backtests.slice(-20) }));

  r.post("/backtests", admin, (req, res) => {
    const body = z.object({
      symbol: symbolParam,
      days: z.coerce.number().int().min(5).max(60).default(40),
      productType: z.enum(["DELIVERY", "INTRADAY"]).default("DELIVERY"),
      slippageBps: z.number().min(0).max(100).default(5),
      oosFraction: z.number().min(0).max(0.5).default(0),
    }).parse(req.body);
    requireKnown(body.symbol);
    const candles = bars(body.symbol, body.days);
    const opts = { productType: body.productType, slippageBps: body.slippageBps };
    const run = runBacktest(body.symbol, candles, EMA_MOMENTUM_PRO, opts);
    const metrics = computeMetrics(run.trades, EMA_MOMENTUM_PRO.capital, run.equity);
    let walkForward: unknown = null;
    if (body.oosFraction > 0) {
      const { inSample, outOfSample } = splitByDay(candles, body.oosFraction);
      if (inSample.length < 375 * 5 || outOfSample.length < 375 * 3) throw new AppError(400, "NOT_ENOUGH_SESSIONS", "Need at least 5 in-sample and 3 out-of-sample sessions");
      const isRun = runBacktest(body.symbol, inSample, EMA_MOMENTUM_PRO, opts);
      const oosRun = runBacktest(body.symbol, outOfSample, EMA_MOMENTUM_PRO, opts);
      walkForward = {
        oosFraction: body.oosFraction,
        inSample: { bars: inSample.length, metrics: computeMetrics(isRun.trades, EMA_MOMENTUM_PRO.capital, isRun.equity) },
        outOfSample: { bars: outOfSample.length, metrics: computeMetrics(oosRun.trades, EMA_MOMENTUM_PRO.capital, oosRun.equity) },
        note: "The out-of-sample run restarts indicators, so its first sessions are warm-up. Parameters were not optimised, so this is a stability check, not a proof.",
      };
    }
    const item = { id: `B${backtests.length + 1}`, createdAt: new Date().toISOString(), source: "SAMPLE", symbol: body.symbol, bars: run.bars, signals: run.signals, skipped: run.skipped.length, metrics, walkForward, trades: run.trades.slice(-100), equity: run.equity.slice(-500) };
    audit.record("backtest.run", "OK", `${body.symbol} ${body.days}d oos=${body.oosFraction}`);
    backtests.push(item);
    if (backtests.length > 20) backtests.splice(0, backtests.length - 20);
    res.status(201).json(item);
  });

  r.get("/paper", (_req, res) => res.json({ ...paper.snapshot(), note: "Paper trading only. No real orders are placed." }));

  r.post("/paper/scan", admin, (_req, res) => {
    audit.record("paper.scan");
    const out = SAMPLE_INSTRUMENTS.map((i) => {
      const candles = bars(i.symbol);
      paper.onBar(i.symbol, candles);
      const s = paper.submitSignal(i.symbol, candles, true);
      return { symbol: i.symbol, status: s.status, reasons: s.reasons };
    });
    res.json({ source: "SAMPLE", results: out, paper: paper.snapshot() });
  });

  r.post("/paper/emergency-stop", admin, (req, res) => {
    const body = z.object({ active: z.boolean() }).parse(req.body);
    paper.emergencyStop = body.active;
    audit.record("paper.emergency_stop", "OK", String(body.active));
    let flattened = 0;
    if (body.active) {
      const prices = new Map(SAMPLE_INSTRUMENTS.map((i) => [i.symbol, bars(i.symbol).at(-1)!.close]));
      flattened = paper.flatten(Date.now(), prices);
    }
    res.json({ emergencyStop: paper.emergencyStop, flattened });
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
    const candles = bars(symbol);
    const closes = candles.map((c) => c.close);
    const m = macd(closes);
    const bb = bollinger(closes);
    const a = adx(candles);
    res.json({
      source: "SAMPLE", symbol, asOf: new Date(candles.at(-1)!.time).toISOString(), close: candles.at(-1)!.close,
      values: {
        ema20: last(ema(closes, 20)), ema50: last(ema(closes, 50)), ema200: last(ema(closes, 200)), sma50: last(sma(closes, 50)),
        rsi14: last(rsi(closes, 14)), macd: last(m.macd as (number | null)[]), macdSignal: last(m.signal as (number | null)[]),
        adx14: last(a.adx as (number | null)[]), atr14: last(atr(candles, 14)), vwap: last(vwap(candles)),
        bollingerUpper: last(bb.upper as (number | null)[]), bollingerLower: last(bb.lower as (number | null)[]),
      },
      note: "Last value of each indicator on SAMPLE bars. null means not enough history.",
    });
  });

  r.get("/mtf/:symbol", (req, res) => {
    const symbol = symbolParam.parse(req.params.symbol);
    requireKnown(symbol);
    const base = bars(symbol, 20);
    const frames = ["1", "5", "15"].map((iv) => {
      const cs = iv === "1" ? base : aggregate(base, 1, Number(iv));
      const closes = cs.map((c) => c.close);
      const e20 = last(ema(closes, 20)), e50 = last(ema(closes, 50)), r14 = last(rsi(closes, 14));
      const bias = e20 == null || e50 == null ? "UNKNOWN" : e20 > e50 ? "BULLISH" : e20 < e50 ? "BEARISH" : "NEUTRAL";
      return { interval: Number(iv), bars: cs.length, close: cs.at(-1)?.close ?? null, ema20: e20, ema50: e50, rsi14: r14, bias };
    });
    const agree = frames.every((f) => f.bias === frames[0].bias) && frames[0].bias !== "UNKNOWN";
    res.json({ source: "SAMPLE", symbol, frames, alignment: agree ? frames[0].bias : "MIXED", note: "Trend bias from EMA 20 vs EMA 50 on each timeframe. Not a trading signal." });
  });

  r.get("/data/quality/:symbol", (req, res) => {
    const symbol = symbolParam.parse(req.params.symbol);
    requireKnown(symbol);
    const raw = bars(symbol, 20);
    const rep = sanitizeCandles(raw);
    const reasons: Record<string, number> = {};
    for (const d of rep.dropped) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
    res.json({
      source: "SAMPLE", symbol, received: raw.length, kept: rep.candles.length, dropped: rep.dropped.length, duplicates: rep.duplicates,
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
    res.json({ source: "SAMPLE", items, note: "Change is versus the previous session's last close in SAMPLE data." });
  });

  r.get("/journal", (_req, res) => {
    const items = paper.trades.map((t) => {
      const key = `${t.symbol}:${t.exitTime}`;
      return { key, ...t, note: journalNotes.get(key) ?? "" };
    });
    res.json({ items: items.slice(-200).reverse(), note: "Notes are kept in memory and reset on restart." });
  });

  r.put("/journal/note", admin, (req, res) => {
    const body = z.object({ key: z.string().regex(/^[A-Z0-9&-]{1,20}:\d+$/), note: z.string().max(500) }).parse(req.body);
    if (!paper.trades.some((t) => `${t.symbol}:${t.exitTime}` === body.key)) throw new AppError(404, "NOT_FOUND", "No paper trade with that key");
    if (!journalNotes.has(body.key) && journalNotes.size >= 1000) throw new AppError(409, "LIMIT", "Journal note limit reached");
    journalNotes.set(body.key, body.note.trim());
    audit.record("journal.note", "OK", body.key.split(":")[0]);
    res.json({ key: body.key, note: body.note.trim() });
  });

  r.get("/analyst/:symbol", (req, res) => {
    const symbol = symbolParam.parse(req.params.symbol);
    requireKnown(symbol);
    const candles = bars(symbol);
    const closes = candles.map((c) => c.close);
    const S = computeSeries(candles, EMA_MOMENTUM_PRO);
    const i = candles.length - 1;
    const ev = evaluateLong(S, i, EMA_MOMENTUM_PRO, { complete: true });
    const e20 = last(ema(closes, 20)), e50 = last(ema(closes, 50)), e200 = last(ema(closes, 200));
    const r14 = last(rsi(closes, 14)), price = candles[i].close;
    const lines: string[] = [];
    if (e20 != null && e50 != null) lines.push(e20 > e50 ? `The 20-period EMA (${fmtNum(e20)}) is above the 50-period EMA (${fmtNum(e50)}), which points to an uptrend on these bars.` : `The 20-period EMA (${fmtNum(e20)}) is below the 50-period EMA (${fmtNum(e50)}), which points to a downtrend on these bars.`);
    else lines.push("Not enough history to compare the moving averages.");
    if (e200 != null) lines.push(price > e200 ? `Price is above the 200-period EMA (${fmtNum(e200)}).` : `Price is below the 200-period EMA (${fmtNum(e200)}).`);
    if (r14 != null) lines.push(r14 > 70 ? `RSI is ${fmtNum(r14, 1)}, which is in the overbought zone (above 70).` : r14 < 30 ? `RSI is ${fmtNum(r14, 1)}, which is in the oversold zone (below 30).` : `RSI is ${fmtNum(r14, 1)}, which is neither overbought nor oversold.`);
    const failed = ev.checks.filter((c) => c.enabled && c.pass === false).map((c) => c.label);
    lines.push(ev.signal === "BUY" ? "All mandatory strategy conditions pass on the latest closed bar, so the scanner shows BUY." : `The scanner shows WAIT. Failing conditions: ${failed.length ? failed.join("; ") : "none listed"}.`);
    res.json({
      source: "SAMPLE", symbol, asOf: new Date(candles[i].time).toISOString(), method: "rule-based",
      summary: lines,
      disclaimer: "This is a rule-based summary of indicator values on SAMPLE data. It is not AI analysis, not a forecast and not investment advice.",
    });
  });

  r.get("/watchlists", (_req, res) => res.json({ items: [...watchlists].map(([name, symbols]) => ({ name, symbols })) }));

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
