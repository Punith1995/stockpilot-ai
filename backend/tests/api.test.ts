import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { PaperEngine } from "../src/paper/engine.js";
import { EMA_MOMENTUM_PRO } from "../src/strategy/ema-momentum-pro.js";
import { DEFAULT_RISK_LIMITS } from "../src/risk/risk-manager.js";
import { sampleCandles } from "../src/data/sample.js";

const TOKEN = "test-admin-token-123456";
const withToken = loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) });
const noToken = loadEnv({ NODE_ENV: "test" });

describe("config", () => {
  it("production refuses to start without ADMIN_TOKEN, ENCRYPTION_KEY and CORS_ORIGINS", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/Production requires/);
  });
  it("kite is reported as not configured when credentials are missing", () => {
    expect(withToken.kiteConfigured).toBe(false);
  });
});

describe("HTTP API", () => {
  const { app } = createApp(withToken);
  it("health endpoint responds", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
  it("status labels data as SAMPLE and live trading as not implemented", async () => {
    const res = await request(app).get("/api/v1/status");
    expect(res.body.dataSource).toBe("SAMPLE");
    expect(res.body.liveTrading).toBe("NOT_IMPLEMENTED");
  });
  it("live order endpoint is disabled", async () => {
    const res = await request(app).post("/api/v1/live/orders").send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("LIVE_TRADING_DISABLED");
  });
  it("rejects a backtest without the admin token", async () => {
    const res = await request(app).post("/api/v1/backtests").send({ symbol: "TCS" });
    expect(res.status).toBe(401);
  });
  it("runs a backtest with the admin token and returns labelled metrics", async () => {
    const res = await request(app).post("/api/v1/backtests").set("X-Admin-Token", TOKEN).send({ symbol: "TCS", days: 20 });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe("SAMPLE");
    expect(res.body.metrics).toHaveProperty("profitFactor");
    expect(Array.isArray(res.body.metrics.warnings)).toBe(true);
  });
  it("admin actions fail closed when ADMIN_TOKEN is not configured", async () => {
    const { app: open } = createApp(noToken);
    const res = await request(open).post("/api/v1/paper/scan").set("X-Admin-Token", "anything-at-all-123");
    expect(res.status).toBe(503);
  });
  it("rejects malformed symbols and unknown symbols", async () => {
    expect((await request(app).get("/api/v1/candles/..%2Fetc")).status).toBe(400);
    expect((await request(app).get("/api/v1/candles/NOPE")).status).toBe(404);
    expect((await request(app).get("/api/v1/analysis/tcs!")).status).toBe(400);
  });
  it("broker login URL is refused when Kite is not configured", async () => {
    const res = await request(app).get("/api/v1/broker/login-url");
    expect(res.status).toBe(503);
  });
  it("unknown endpoints return a JSON 404 without stack traces", async () => {
    const res = await request(app).get("/api/v1/nothing-here");
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/at \w+/);
  });
});

describe("paper trading safety", () => {
  it("never queues an order while the emergency stop is active", () => {
    const paper = new PaperEngine({ ...DEFAULT_RISK_LIMITS, capital: EMA_MOMENTUM_PRO.capital }, EMA_MOMENTUM_PRO);
    paper.emergencyStop = true;
    for (const sym of ["TCS", "INFY", "RELIANCE"]) {
      const c = sampleCandles(sym, 20, 1000);
      expect(paper.submitSignal(sym, c).status).not.toBe("QUEUED");
    }
    expect(paper.orders).toHaveLength(0);
  });
  it("the same signal bar never produces two queued orders", () => {
    const paper = new PaperEngine({ ...DEFAULT_RISK_LIMITS, capital: EMA_MOMENTUM_PRO.capital }, EMA_MOMENTUM_PRO);
    const scan = (sym: string) => paper.submitSignal(sym, sampleCandles(sym, 20, 1000));
    const first = scan("TCS");
    const second = scan("TCS");
    if (first.status === "QUEUED") expect(second.status).toBe("DUPLICATE");
    else expect(second.status).not.toBe("QUEUED");
    expect(paper.orders.filter((o) => o.symbol === "TCS").length).toBeLessThanOrEqual(1);
  });
});
