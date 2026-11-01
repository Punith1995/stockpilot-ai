import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const TOKEN = "test-admin-token-123456";
const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) }));

describe("scanner timeframe and universe", () => {
  it("echoes the interval and universe used", async () => {
    const res = await request(app).post("/api/v1/scanner/run").send({ interval: "15" });
    expect(res.status).toBe(200);
    expect(res.body.interval).toBe(15);
    expect(res.body.universe).toBe("SAMPLE_STOCKS");
    expect(res.body.count).toBe(5);
  });
  it("custom universe scans only the given symbols", async () => {
    const res = await request(app).post("/api/v1/scanner/run").send({ universe: "CUSTOM", symbols: ["TCS", "INFY"] });
    expect(res.body.results.map((r: { symbol: string }) => r.symbol).sort()).toEqual(["INFY", "TCS"]);
  });
  it("custom universe without symbols is rejected", async () => {
    expect((await request(app).post("/api/v1/scanner/run").send({ universe: "CUSTOM", symbols: [] })).status).toBe(400);
  });
});

describe("journal timestamps", () => {
  it("note save returns and lists a timestamp", async () => {
    const list = await request(app).get("/api/v1/journal");
    expect(list.body.items.every((i: { noteAt: unknown }) => "noteAt" in i)).toBe(true);
    if (!list.body.items.length) return;
    const key = list.body.items[0].key;
    const saved = await request(app).put("/api/v1/journal/note").set("X-Admin-Token", TOKEN).send({ key, note: "test" });
    expect(saved.status).toBe(200);
    expect(typeof saved.body.noteAt).toBe("number");
    const again = await request(app).get("/api/v1/journal");
    expect(again.body.items[0].noteAt).toBeTypeOf("number");
  });
});

describe("chart series for the reference layout", () => {
  it("returns EMA 200, volume and 20-bar volume average aligned with candles", async () => {
    const res = await request(app).get("/api/v1/chart/RELIANCE?interval=5&days=20");
    expect(res.status).toBe(200);
    const n = res.body.candles.length;
    expect(res.body.ema200).toHaveLength(n);
    expect(res.body.volume).toHaveLength(n);
    expect(res.body.volumeAvg20).toHaveLength(n);
    expect(res.body.volume.every((v: number) => v >= 0)).toBe(true);
  });
});

describe("chart setup panel data", () => {
  it("returns checks and a plan (or null) with the setup", async () => {
    const res = await request(app).get("/api/v1/chart/TCS?interval=5&days=20");
    expect(res.body.setup.checks.length).toBeGreaterThan(0);
    expect(["BUY", "WAIT"]).toContain(res.body.setup.signal);
    if (res.body.setup.plan) {
      const p = res.body.setup.plan;
      expect(p.stop).toBeLessThan(p.entry);
      expect(p.target1).toBeGreaterThan(p.entry);
      expect(p.target2).toBeGreaterThan(p.target1);
    }
  });
});

describe("market breadth lists", () => {
  it("top losers only contain negative changes and gainers only positive", async () => {
    const res = await request(app).get("/api/v1/market/quotes");
    expect(res.status).toBe(200);
    for (const g of res.body.topGainers) expect(g.changePct).toBeGreaterThan(0);
    for (const l of res.body.topLosers) expect(l.changePct).toBeLessThan(0);
  });
});

describe("scanner columns, chart toolbar intervals", () => {
  it("scanner rows carry the spec columns", async () => {
    const res = await request(app).post("/api/v1/scanner/run").send({});
    const r = res.body.results[0];
    for (const k of ["price", "changePct", "trend", "emaStatus", "rsi", "macd", "adx", "relVolume"]) expect(r).toHaveProperty(k);
    expect(["Bullish", "Bearish", null]).toContain(r.trend);
  });
  it("chart accepts the toolbar timeframes and daily, and returns markers and levels", async () => {
    for (const iv of ["3", "10", "30", "60", "240", "D"]) {
      const res = await request(app).get(`/api/v1/chart/TCS?interval=${iv}&days=20`);
      expect(res.status).toBe(200);
      expect(res.body.candles.length).toBeGreaterThan(0);
    }
    const res = await request(app).get("/api/v1/chart/TCS?interval=D&days=20");
    expect(res.body.interval).toBe("D");
    expect(res.body.levels).toHaveProperty("support");
    expect(Array.isArray(res.body.markers)).toBe(true);
  });
});

describe("backtest strategy, timeframe and capital", () => {
  it("runs a selected simple strategy at a chosen timeframe and capital", async () => {
    const res = await request(app).post("/api/v1/backtests").set("X-Admin-Token", "test-admin-token-123456").send({ symbol: "TCS", strategyId: "supertrend", interval: "15", capital: 200000, days: 40 });
    expect(res.status).toBe(201);
    expect(res.body.strategyId).toBe("supertrend");
    expect(res.body.interval).toBe("15");
    expect(res.body.capital).toBe(200000);
    expect(res.body.metrics).toHaveProperty("expectancyR");
  });
  it("still runs the default EMA Momentum Pro strategy", async () => {
    const res = await request(app).post("/api/v1/backtests").set("X-Admin-Token", "test-admin-token-123456").send({ symbol: "TCS", days: 20 });
    expect(res.status).toBe(201);
    expect(res.body.strategyId).toBe("ema-momentum-pro");
  });
});

describe("technical summary", () => {
  it("returns indicator cards, a rule-based summary and levels", async () => {
    const res = await request(app).get("/api/v1/indicators/TCS?interval=5");
    expect(res.status).toBe(200);
    expect(res.body.values).toHaveProperty("relativeVolume");
    expect(["Bullish", "Bearish", "Sideways", "Not enough history"]).toContain(res.body.summary.trend);
    expect(["Strong", "Weak", "Neutral", "Not enough history"]).toContain(res.body.summary.momentum);
    expect(["High", "Normal", "Low", "Not enough history"]).toContain(res.body.summary.volume);
    expect(res.body.summary.final).toMatch(/Not a (buy|sell) recommendation|Mixed|Wait/);
  });
});

describe("watchlist overview", () => {
  it("returns scanner columns for each symbol in a saved watchlist", async () => {
    await request(app).put("/api/v1/watchlists/banks").set("X-Admin-Token", "test-admin-token-123456").send({ symbols: ["HDFCBANK", "ICICIBANK"] });
    const res = await request(app).get("/api/v1/watchlists/banks/overview?interval=15");
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { symbol: string }) => i.symbol)).toEqual(["HDFCBANK", "ICICIBANK"]);
    expect(res.body.items[0]).toHaveProperty("rsi");
  });
  it("unknown watchlist is 404", async () => {
    expect((await request(app).get("/api/v1/watchlists/nope-missing/overview")).status).toBe(404);
  });
});
