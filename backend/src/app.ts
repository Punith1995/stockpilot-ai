import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { Env } from "./config/env.js";
import { createRouter } from "./routes/index.js";
import { KiteService } from "./broker/kite.js";
import { PaperEngine } from "./paper/engine.js";
import { errorHandler } from "./utils/errors.js";
import { EMA_MOMENTUM_PRO } from "./strategy/ema-momentum-pro.js";
import { DEFAULT_RISK_LIMITS } from "./risk/risk-manager.js";
import { AuditLog } from "./audit/log.js";
import { AlertStore } from "./alerts/store.js";
import { createExtraRouter } from "./routes/extra.js";
import { KiteHistorical } from "./data/kite-historical.js";
import { MarketData } from "./data/market.js";

export function createApp(env: Env) {
  const app = express();
  const paper = new PaperEngine({ ...DEFAULT_RISK_LIMITS, capital: EMA_MOMENTUM_PRO.capital }, EMA_MOMENTUM_PRO);
  const kite = new KiteService(env);
  const audit = new AuditLog();
  const alerts = new AlertStore();
  const kiteData = new KiteHistorical();
  const market = new MarketData(env, kite, kiteData);
  market.startBackground();
  const bars = (sym: string, days = 30) => market.bars(sym, days);
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Render sits behind a proxy
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: false }));
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
  app.get("/health", (_req, res) => res.json({ ok: true, uptimeSec: Math.round(process.uptime()) }));
  // Before any API call reads candles: refresh the five core stocks, and load any other NSE stock the request names.
  // No-op when no Kite session is active.
  app.use("/api/v1", async (req, _res, next) => {
    try {
      await market.ensure();
      const named = new Set<string>();
      for (const seg of req.path.split("/")) if (/^[A-Z][A-Z0-9&-]{0,19}$/.test(seg)) named.add(seg);
      const b = req.body as { symbol?: unknown; symbols?: unknown } | undefined;
      if (typeof b?.symbol === "string") named.add(b.symbol);
      if (Array.isArray(b?.symbols)) for (const s of b.symbols) if (typeof s === "string") named.add(s);
      const q = req.query.symbol;
      if (typeof q === "string") named.add(q);
      await market.loadSymbols([...named]);
      next();
    } catch (e) { next(e); }
  });
  app.use("/api/v1", createRouter({ env, paper, kite, audit, kiteData, market }));
  app.use("/api/v1", createExtraRouter({ env, audit, alerts, bars, market, kite, kiteData }));
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "No such endpoint" } }));
  app.use(errorHandler);
  return { app, paper, kite, audit, market };
}
