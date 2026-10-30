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
import type { KiteService } from "../broker/kite.js";

export interface ExtraDeps { env: Env; audit: AuditLog; alerts: AlertStore; bars: (symbol: string, days?: number) => Candle[]; knownSymbols: string[]; kite: KiteService; kiteData: KiteHistorical }

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

export function createExtraRouter({ env, audit, alerts, bars, knownSymbols, kite, kiteData }: ExtraDeps): Router {
  const r = Router();
  const admin = requireAdmin(env.ADMIN_TOKEN);
  const presets: { id: string; name: string; overrides: z.infer<typeof overrides>; createdAt: string }[] = [];
  let seq = 1;
  const need = (s: string) => { if (!knownSymbols.includes(s)) throw new AppError(404, "UNKNOWN_SYMBOL", `${s} is not in the sample instrument list`); };

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
    if (inSample.length < 375 * 5 || outOfSample.length < 375 * 3) throw new AppError(400, "NOT_ENOUGH_SESSIONS", "Need at least 5 in-sample and 3 out-of-sample sessions");
    const opts = { productType: "DELIVERY" as const, slippageBps: 5 };
    const rows = combos.map((c) => {
      const cfg: StrategyConfig = { ...EMA_MOMENTUM_PRO, ...c };
      const isRun = runBacktest(body.symbol, inSample, cfg, opts);
      const isM = computeMetrics(isRun.trades, cfg.capital, isRun.equity);
      const oosRun = runBacktest(body.symbol, outOfSample, cfg, opts);
      const oosM = computeMetrics(oosRun.trades, cfg.capital, oosRun.equity);
      return { ...c, inSample: { trades: isM.trades, netProfit: isM.netProfit, profitFactor: isM.profitFactor }, outOfSample: { trades: oosM.trades, netProfit: oosM.netProfit, profitFactor: oosM.profitFactor, maxDrawdownPct: oosM.maxDrawdownPct } };
    }).sort((a, b) => b.outOfSample.netProfit - a.outOfSample.netProfit);
    audit.record("strategy.sweep", "OK", `${body.symbol} ${combos.length} combos`);
    res.json({
      source: "SAMPLE", symbol: body.symbol, combinations: combos.length, rows,
      warning: `${combos.length} combinations were tested. The best out-of-sample result is likely optimistic because the choice was made by looking at the same data. Confirm with real data before trusting it.`,
    });
  });

  // ---- Alerts ----
  r.get("/alerts", (_req, res) => res.json({ items: alerts.rules, note: "Rules are checked only when you press Check. No email, SMS or push delivery exists." }));

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
    const fired: string[] = [];
    const pending: Promise<void>[] = [];
    for (const rule of alerts.rules) {
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
        if (env.ALERT_WEBHOOK_URL) pending.push(sendWebhook(env.ALERT_WEBHOOK_URL, { symbol: rule.symbol, message, at: item.at }).then((d) => { item.delivery = d.delivered ? "DELIVERED" : "FAILED"; item.deliveryError = d.error; }));
      }
    }
    await Promise.all(pending);
    res.json({ checked: alerts.rules.length, fired, source: "SAMPLE", webhook: env.ALERT_WEBHOOK_URL ? "configured" : "not configured" });
  });

  // ---- Kite historical data (unverified; SAMPLE stays the default for every other endpoint) ----
  r.get("/data/source", (_req, res) => {
    res.json({
      defaultSource: "SAMPLE", kiteSessionActive: kite.status().connected, kiteInstruments: kiteData.instrumentCount,
      instrumentsLoadedAt: kiteData.instrumentsLoadedAt,
      note: "Kite historical data is opt-in per request and unverified against the live service. Charts and scans keep using SAMPLE unless you call the Kite endpoints.",
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

  r.get("/notifications", (_req, res) => res.json({ items: [...alerts.notifications].reverse().slice(0, 100), note: "In-app only. Reset on restart." }));

  return r;
}
