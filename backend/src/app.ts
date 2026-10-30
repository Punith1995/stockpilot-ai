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
import { SAMPLE_INSTRUMENTS, sampleCandles } from "./data/sample.js";

export function createApp(env: Env) {
  const app = express();
  const paper = new PaperEngine({ ...DEFAULT_RISK_LIMITS, capital: EMA_MOMENTUM_PRO.capital }, EMA_MOMENTUM_PRO);
  const kite = new KiteService(env);
  const audit = new AuditLog();
  const alerts = new AlertStore();
  const kiteData = new KiteHistorical();
  const barCache = new Map<string, ReturnType<typeof sampleCandles>>();
  const bars = (sym: string, days = 30) => {
    const key = `${sym}:${days}`;
    let c = barCache.get(key);
    if (!c) { c = sampleCandles(sym, days, SAMPLE_INSTRUMENTS.find((i) => i.symbol === sym)?.basePrice ?? 1000); barCache.set(key, c); }
    return c;
  };
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Render sits behind a proxy
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: false }));
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
  app.get("/health", (_req, res) => res.json({ ok: true, uptimeSec: Math.round(process.uptime()) }));
  app.use("/api/v1", createRouter({ env, paper, kite, audit }));
  app.use("/api/v1", createExtraRouter({ env, audit, alerts, bars, knownSymbols: SAMPLE_INSTRUMENTS.map((i) => i.symbol), kite, kiteData }));
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "No such endpoint" } }));
  app.use(errorHandler);
  return { app, paper, kite, audit };
}
