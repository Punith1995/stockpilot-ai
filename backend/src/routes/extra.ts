import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import type { Candle } from "../domain/candles.js";
import { runBacktest, splitByDay } from "../backtest/engine.js";
import { computeMetrics } from "../backtest/metrics.js";
import { EMA_MOMENTUM_PRO, computeSeries, evaluateLong, type StrategyConfig } from "../strategy/ema-momentum-pro.js";
import { AlertStore } from "../alerts/store.js";
import type { AuditLog } from "../audit/log.js";
import { AppError } from "../utils/errors.js";
import { requireAdmin } from "./middleware.js";
import { sendWebhook } from "../alerts/webhook.js";
import { KiteHistorical, KITE_INTERVALS, type KiteInterval } from "../data/kite-historical.js";
import { SAMPLE_INDICES } from "../data/indices.js";
import { istParts } from "../domain/candles.js";
import { SIMPLE_STRATEGIES } from "../strategies/library.js";
import { BUILT_IN_ID, isEnabled, knownStrategyIds, paramsFor, registryItems, setEnabled, setParams } from "../strategies/registry.js";
import { runGeneric } from "../backtest/generic-engine.js";
import { SAMPLE_INSTRUMENTS } from "../data/sample.js";
import type { MarketData } from "../data/market.js";
import type { KiteService } from "../broker/kite.js";

export interface ExtraDeps { env: Env; audit: AuditLog; alerts: AlertStore; bars: (symbol: string, days?: number) => Candle[]; market: MarketData; kite: KiteService; kiteData: KiteHistorical }

const symbol = z.string().regex(/^[A-Z0-9&-]{1,20}$/);
const overrides = z.object({
  rsiMin: z.number().min(0).max(100).optional(),
  rsiMax: z.number().min(0).max(100).optional(),
  minRelativeVolume: z.number().min(0).max(20).optional(),
  minAdx: z.number().min(0).max(100).optional(),
  targetR: z.number().min(0.5).max(10).optional(),
  atrMultiple: z.number().min(0.5).max(5).optional(),
}).refine((o) => o.rsiMin == null || o.rsiMax == null || o.rsiMin <= o.rsiMax, { message: "rsiMin must not exceed rsiMax" });

function handleKite(e: unknown, next: (err: unknown) => void): void {
  const code = (e as { code?: string }).code;
  if (code === "SESSION_EXPIRED") return next(new AppError(401, "KITE_SESSION_EXPIRED", "Kite session expired. Log in again on the Connection page."));
  if (code === "UNKNOWN_INSTRUMENT") return next(new AppError(404, "UNKNOWN_INSTRUMENT", (e as Error).message));
  next(e instanceof AppError ? e : new AppError(502, "KITE_ERROR", e instanceof Error ? e.message : "Kite request failed"));
}

export function createExtraRouter({ env, audit, alerts, bars, market, kite, kiteData }: ExtraDeps): Router {
  const src = () => market.label();
  const r = Router();
  const admin = requireAdmin(env.ADMIN_TOKEN);
  const presets: { id: string; name: string; overrides: z.infer<typeof overrides>; createdAt: string }[] = [];
  let seq = 1;
  const need = (s: string) => { if (!market.isKnown(s)) throw new AppError(404, "UNKNOWN_SYMBOL", `${s} is not a known stock`); };

  // ---- Strategy library ----
  r.get("/strategy-library", (_req, res) => {
    res.json({
      builtIn: { id: "ema-momentum-pro", name: "EMA Momentum Pro (built-in)", overrides: {}, builtIn: true },
      saved: presets.slice(-50),
      note: "Saved presets are in memory and reset on restart. A preset only stores parameter overrides; it does not change the built-in logic.",
    });
  });

  r.post("/strategy-library", admin, (req, res) => {
    const body = z.object({ name: z.string().trim().min(1).max(60), overrides }).parse(req.body);
    if (presets.length >= 50) throw new AppError(409, "LIMIT", "Maximum 50 saved presets");
    const preset = { id: `S${seq++}`, name: body.name, overrides: body.overrides, createdAt: new Date().toISOString() };
    presets.push(preset);
    audit.record("strategy.preset_save", "OK", body.name);
    res.status(201).json(preset);
  });

  // ---- Strategy lab: small grid sweep, ranked on out-of-sample ----
  r.post("/strategy-lab/sweep", admin, (req, res) => {
    const body = z.object({
      symbol,
      days: z.coerce.number().int().min(10).max(60).default(40),
      targetR: z.array(z.number().min(0.5).max(10)).min(1).max(3),
      atrMultiple: z.array(z.number().min(0.5).max(5)).min(1).max(3),
      oosFraction: z.number().min(0.1).max(0.5).default(0.3),
    }).parse(req.body);
    need(body.symbol);
    const combos = body.targetR.flatMap((t) => body.atrMultiple.map((a) => ({ targetR: t, atrMultiple: a })));
    const candles = bars(body.symbol, body.days);
    const { inSample, outOfSample } = splitByDay(candles, body.oosFraction);
    if (new Set(inSample.map((c) => istParts(c.time).dayKey)).size < 5 || new Set(outOfSample.map((c) => istParts(c.time).dayKey)).size < 3) throw new AppError(400, "NOT_ENOUGH_SESSIONS", "Need at least 5 in-sample and 3 out-of-sample sessions");
    const opts = { productType: "DELIVERY" as const, slippageBps: 5 };
    const rows = combos.map((c) => {
      const cfg: StrategyConfig = { ...EMA_MOMENTUM_PRO, ...c };
      const isRun = runBacktest(body.symbol, inSample, cfg, opts);
      const isM = computeMetrics(isRun.trades, cfg.capital, isRun.equity);
      const oosRun = runBacktest(body.symbol, outOfSample, cfg, opts);
      const oosM = computeMetrics(oosRun.trades, cfg.capital, oosRun.equity);
      const monthly = [...oosRun.trades.reduce((m, t) => m.set(new Date(t.exitTime + 19_800_000).toISOString().slice(0, 7), (m.get(new Date(t.exitTime + 19_800_000).toISOString().slice(0, 7)) ?? 0) + t.netPnl), new Map<string, number>())]
        .map(([month, netPnl]) => ({ month, netPnl: Math.round(netPnl * 100) / 100 }));
      const step = Math.max(1, Math.ceil(oosRun.equity.length / 120));
      const equity = oosRun.equity.filter((_, idx) => idx % step === 0).map((pt) => ({ time: pt.time, equity: pt.equity }));
      return { ...c, inSample: { trades: isM.trades, netProfit: isM.netProfit, profitFactor: isM.profitFactor, winRate: isM.winRate }, outOfSample: { trades: oosM.trades, netProfit: oosM.netProfit, profitFactor: oosM.profitFactor, maxDrawdownPct: oosM.maxDrawdownPct, winRate: oosM.winRate, monthly, equity } };
    }).sort((a, b) => b.outOfSample.netProfit - a.outOfSample.netProfit);
    audit.record("strategy.sweep", "OK", `${body.symbol} ${combos.length} combos`);
    res.json({
      source: src(), symbol: body.symbol, combinations: combos.length, rows,
      warning: `${combos.length} combinations were tested. The best out-of-sample result is likely optimistic because the choice was made by looking at the same data. Confirm with real data before trusting it.`,
    });
  });

  // ---- Alerts ----
  r.get("/alerts", (_req, res) => res.json({
    items: alerts.rules.map((rule) => ({ ...rule, currentValue: bars(rule.symbol, 20).at(-1)?.close ?? null })),
    note: "Rules are checked only when you press Check. No email, SMS or push delivery exists.",
  }));

  r.put("/alerts/:id", admin, (req, res) => {
    const id = z.string().regex(/^A\d+$/).parse(req.params.id);
    const body = z.object({ enabled: z.boolean().optional(), value: z.number().positive().optional() }).parse(req.body);
    const rule = alerts.rules.find((x) => x.id === id);
    if (!rule) throw new AppError(404, "NOT_FOUND", "No such alert");
    if (body.value != null && rule.type === "SIGNAL_BUY") throw new AppError(400, "INVALID", "Scanner alerts have no value");
    if (body.enabled != null) rule.enabled = body.enabled;
    if (body.value != null) rule.value = body.value;
    audit.record("alert.update", "OK", id);
    res.json(rule);
  });

  r.post("/alerts", admin, (req, res) => {
    const body = z.object({
      symbol,
      type: z.enum(["PRICE_ABOVE", "PRICE_BELOW", "SIGNAL_BUY"]),
      value: z.number().positive().optional(),
    }).refine((b) => b.type === "SIGNAL_BUY" || b.value != null, { message: "value is required for price alerts" }).parse(req.body);
    need(body.symbol);
    if (alerts.rules.length >= 50) throw new AppError(409, "LIMIT", "Maximum 50 alert rules");
    const rule = alerts.add(body);
    audit.record("alert.create", "OK", body.symbol);
    res.status(201).json(rule);
  });

  r.delete("/alerts/:id", admin, (req, res) => {
    const id = z.string().regex(/^A\d+$/).parse(req.params.id);
    if (!alerts.remove(id)) throw new AppError(404, "NOT_FOUND", "No such alert");
    audit.record("alert.delete", "OK", id);
    res.status(204).end();
  });

  r.post("/alerts/check", admin, async (_req, res) => {
    await market.loadSymbols(alerts.rules.map((rule) => rule.symbol));
    const fired: string[] = [];
    const pending: Promise<void>[] = [];
    for (const rule of alerts.rules) {
      if (!rule.enabled) continue;
      const cs = bars(rule.symbol, 20);
      const last = cs.at(-1)!;
      let hit = false;
      if (rule.type === "PRICE_ABOVE") hit = last.close > rule.value!;
      if (rule.type === "PRICE_BELOW") hit = last.close < rule.value!;
      if (rule.type === "SIGNAL_BUY") hit = evaluateLong(computeSeries(cs, EMA_MOMENTUM_PRO), cs.length - 1, EMA_MOMENTUM_PRO, { complete: true }).signal === "BUY";
      if (hit) {
        const message = rule.type === "SIGNAL_BUY" ? `${rule.symbol}: scanner signal BUY on latest bar` : `${rule.symbol}: close ${last.close} ${rule.type === "PRICE_ABOVE" ? "above" : "below"} ${rule.value}`;
        const item = alerts.notify({ ruleId: rule.id, symbol: rule.symbol, message, delivery: env.ALERT_WEBHOOK_URL ? undefined : "NOT_CONFIGURED" });
        fired.push(rule.id);
        rule.triggeredAt = item.at;
        if (env.ALERT_WEBHOOK_URL) pending.push(sendWebhook(env.ALERT_WEBHOOK_URL, { symbol: rule.symbol, message, at: item.at }).then((d) => { item.delivery = d.delivered ? "DELIVERED" : "FAILED"; item.deliveryError = d.error; }));
      }
    }
    await Promise.all(pending);
    res.json({ checked: alerts.rules.length, fired, source: src(), webhook: env.ALERT_WEBHOOK_URL ? "configured" : "not configured" });
  });

  // ---- Kite historical data (unverified; SAMPLE stays the default for every other endpoint) ----
  r.get("/data/source", (_req, res) => {
    res.json({
      defaultSource: "SAMPLE", kiteSessionActive: kite.status().connected, kiteInstruments: kiteData.instrumentCount,
      instrumentsLoadedAt: kiteData.instrumentsLoadedAt,
      note: "Kite historical data is opt-in per request and unverified against the live service. After login the five stocks load live bars for charts, scans, backtests and the rest. Indices stay SAMPLE.",
    });
  });

  r.post("/data/kite/instruments", admin, async (_req, res, next) => {
    try {
      const token = kite.accessToken();
      if (!token || !env.KITE_API_KEY) throw new AppError(409, "KITE_NOT_CONNECTED", "Log in to Kite on the Connection page first");
      const count = await kiteData.loadInstruments(env.KITE_API_KEY, token);
      audit.record("kite.instruments_load", "OK", String(count));
      res.json({ loaded: count, loadedAt: kiteData.instrumentsLoadedAt, source: "KITE (unverified)" });
    } catch (e) { handleKite(e, next); }
  });

  r.get("/data/kite/candles/:symbol", admin, async (req, res, next) => {
    try {
      const sym = symbol.parse(req.params.symbol);
      const q = z.object({ interval: z.enum(["1", "5", "15", "60", "D"]).default("5"), days: z.coerce.number().int().min(1).max(365).default(20) }).parse(req.query);
      const token = kite.accessToken();
      if (!token || !env.KITE_API_KEY) throw new AppError(409, "KITE_NOT_CONNECTED", "Log in to Kite on the Connection page first");
      const out = await kiteData.fetchCandles(env.KITE_API_KEY, token, sym, q.interval as KiteInterval, q.days);
      audit.record("kite.candles_fetch", "OK", `${sym} ${KITE_INTERVALS[q.interval as KiteInterval]} ${q.days}d`);
      res.json({ source: "KITE (unverified)", symbol: sym, interval: q.interval, requests: out.requests, skippedRows: out.skipped, count: out.candles.length, candles: out.candles.slice(-500) });
    } catch (e) { handleKite(e, next); }
  });

  // ---- Market quotes: SAMPLE by default, Kite when a session is active; falls back with a reason ----
  type Quote = { symbol: string; last: number; change: number; changePct: number };
  const sampleQuote = (symbol: string, base: number): Quote => {
    const cs = bars(symbol, 20);
    const last = cs.at(-1)!.close;
    const prev = cs.filter((c) => c.time < cs.at(-1)!.time - (cs.at(-1)!.time % 86_400_000)).at(-1)?.close ?? cs[0]?.open ?? base;
    return { symbol, last: Math.round(last * 100) / 100, change: Math.round((last - prev) * 100) / 100, changePct: Math.round(((last - prev) / prev) * 10000) / 100 };
  };
  r.get("/market/quotes", async (_req, res) => {
    const token = kite.accessToken();
    let source: "SAMPLE" | "KITE" = "SAMPLE";
    let fallbackReason: string | null = token && env.KITE_API_KEY ? null : "Kite is not connected. Showing SAMPLE data.";
    let indices: Quote[] = SAMPLE_INDICES.map((i) => sampleQuote(i.symbol, i.basePrice));
    let stocks: Quote[] = SAMPLE_INSTRUMENTS.map((i) => sampleQuote(i.symbol, i.basePrice));
    if (token && env.KITE_API_KEY) {
      try {
        const keys = [...SAMPLE_INDICES.map((i) => i.kiteKey), ...SAMPLE_INSTRUMENTS.map((i) => `NSE:${i.symbol}`)];
        const live = await kiteData.fetchQuotes(env.KITE_API_KEY, token, keys);
        const mk = (sym: string, key: string): Quote | null => {
          const q = live[key];
          if (!q) return null;
          return { symbol: sym, last: q.last, change: Math.round((q.last - q.prevClose) * 100) / 100, changePct: Math.round(((q.last - q.prevClose) / q.prevClose) * 10000) / 100 };
        };
        const li = SAMPLE_INDICES.map((i) => mk(i.symbol, i.kiteKey));
        const ls = SAMPLE_INSTRUMENTS.map((i) => mk(i.symbol, `NSE:${i.symbol}`));
        if (li.every(Boolean) && ls.every(Boolean)) { indices = li as Quote[]; stocks = ls as Quote[]; source = "KITE"; }
        else fallbackReason = "Kite returned incomplete quotes. Showing SAMPLE data.";
      } catch (e) {
        const expired = (e as { code?: string }).code === "SESSION_EXPIRED";
        fallbackReason = expired ? "Kite session expired. Log in again. Showing SAMPLE data." : "Kite quotes unavailable. Showing SAMPLE data.";
      }
    }
    const adv = stocks.filter((s) => s.change > 0).length, dec = stocks.filter((s) => s.change < 0).length;
    const sorted = [...stocks].sort((a, b) => b.changePct - a.changePct);
    res.json({
      source, fallbackReason, indices, stocks,
      breadth: { advancing: adv, declining: dec, unchanged: stocks.length - adv - dec },
      topGainers: sorted.filter((x) => x.changePct > 0).slice(0, 5), topLosers: sorted.filter((x) => x.changePct < 0).slice(-5).reverse(),
      note: source === "KITE" ? "Live Kite quotes (endpoint unverified)." : "SAMPLE generated data. Not real NSE prices.",
    });
  });

  // ---- Simple strategies (10 in the library): description and side-by-side comparison on SAMPLE data ----
  r.get("/strategy-registry", (_req, res) => {
    res.json({ items: registryItems(), note: "Disabled strategies cannot be backtested or compared. The scanner and charts use the active strategy." });
  });
  r.put("/strategy-registry/:id", admin, (req, res) => {
    const id = z.string().parse(req.params.id);
    if (!knownStrategyIds().includes(id)) throw new AppError(404, "UNKNOWN_STRATEGY", "No strategy with that id");
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    setEnabled(id, body.enabled);
    res.json({ ok: true, id, enabled: isEnabled(id) });
  });

  r.put("/strategy-params/:id", admin, (req, res) => {
    const id = z.string().parse(req.params.id);
    if (id === BUILT_IN_ID) throw new AppError(400, "NOT_EDITABLE", "Edit EMA Momentum Pro in the Strategy Builder");
    if (!paramsFor(id)) throw new AppError(404, "UNKNOWN_STRATEGY", "No strategy with that id");
    const body = z.object({ targetR: z.number().min(0.5).max(10).optional(), maxHoldBars: z.number().int().min(1).max(500).optional(), stopAtr: z.number().min(0.5).max(5).optional() }).parse(req.body);
    if (body.stopAtr != null && paramsFor(id)!.stopAtr == null) throw new AppError(400, "NOT_EDITABLE", "This strategy does not use an ATR stop");
    setParams(id, body);
    audit.record("strategy.params", "OK", id);
    res.json({ ok: true, id, params: paramsFor(id) });
  });

  r.get("/strategies/simple", (_req, res) => {
    res.json({
      items: SIMPLE_STRATEGIES.map((s) => ({ id: s.id, name: s.name, summary: s.summary, bestFor: s.bestFor, product: s.product, targetR: s.targetR, maxHoldBars: s.maxHoldBars })),
      note: "These are common rule sets. None is guaranteed to make money. Use the comparison only to learn how each behaves.",
    });
  });

  r.post("/strategies/compare", admin, (req, res) => {
    const body = z.object({
      symbol,
      days: z.coerce.number().int().min(10).max(60).default(40),
      oosFraction: z.number().min(0.1).max(0.5).default(0.3),
    }).parse(req.body);
    need(body.symbol);
    const candles = bars(body.symbol, body.days);
    const { inSample, outOfSample } = splitByDay(candles, body.oosFraction);
    if (new Set(inSample.map((c) => istParts(c.time).dayKey)).size < 5 || new Set(outOfSample.map((c) => istParts(c.time).dayKey)).size < 3) throw new AppError(400, "NOT_ENOUGH_SESSIONS", "Need at least 5 in-sample and 3 out-of-sample sessions");
    const opts = { capital: 100000, riskPerTradePct: 0.5, maxPositionPct: 25, slippageBps: 5 };
    const rows = SIMPLE_STRATEGIES.filter((s) => isEnabled(s.id)).map((s) => {
      const full = runGeneric(body.symbol, candles, s, opts);
      const oos = runGeneric(body.symbol, outOfSample, s, opts);
      const fm = computeMetrics(full.trades, opts.capital, full.equity);
      const om = computeMetrics(oos.trades, opts.capital, oos.equity);
      return {
        id: s.id, name: s.name, product: s.product,
        full: { trades: fm.trades, winRate: fm.winRate, netProfit: fm.netProfit, profitFactor: fm.profitFactor, maxDrawdownPct: fm.maxDrawdownPct },
        outOfSample: { trades: om.trades, winRate: om.winRate, netProfit: om.netProfit, profitFactor: om.profitFactor, maxDrawdownPct: om.maxDrawdownPct },
      };
    }).sort((a, b) => b.outOfSample.netProfit - a.outOfSample.netProfit);
    audit.record("strategies.compare", "OK", body.symbol);
    res.json({
      source: src(), symbol: body.symbol, ranking: "out-of-sample net profit", rows,
      warning: "Ranking uses generated SAMPLE data. A strategy that did well here may do badly on real NSE prices. This ranking is not a prediction or a recommendation, and no strategy is guaranteed to make a profit.",
    });
  });

  r.get("/notifications", (_req, res) => res.json({ items: [...alerts.notifications].reverse().slice(0, 100), note: "In-app only. Reset on restart." }));

  return r;
}
