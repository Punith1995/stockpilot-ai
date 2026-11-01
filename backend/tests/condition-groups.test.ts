import { describe, expect, it } from "vitest";
import { computeSeries, evaluateLong, EMA_MOMENTUM_PRO, type StrategyConfig } from "../src/strategy/ema-momentum-pro.js";
import type { Candle } from "../src/domain/candles.js";

/** Deterministic rising series with a small wobble, long enough for the 200-bar warmup. */
function series(n = 320): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p += 0.2 + Math.sin(i / 3) * 0.6;
    out.push({ time: 1_700_000_000_000 + i * 300_000, open: p - 0.1, high: p + 0.5, low: p - 0.5, close: p, volume: 1000 + (i % 7) * 50 });
  }
  return out;
}

const cfgWith = (groups: StrategyConfig["groups"]): StrategyConfig => ({ ...EMA_MOMENTUM_PRO, groups });
const last = (cfg: StrategyConfig) => {
  const cs = series();
  const S = computeSeries(cs, cfg);
  return evaluateLong(S, cs.length - 1, cfg, { complete: true });
};

describe("AND/OR condition groups", () => {
  it("OR group passes when any member passes, AND group needs all members", () => {
    const base = last(EMA_MOMENTUM_PRO);
    const pass = (id: string) => base.checks.find((c) => c.id === id)?.pass === true;
    const orRes = last(cfgWith([{ id: "entry", op: "OR", members: ["freshCross", "priceAction"] }])).groups[0];
    const andRes = last(cfgWith([{ id: "entry", op: "AND", members: ["freshCross", "priceAction"] }])).groups[0];
    expect(orRes.pass).toBe(pass("freshCross") || pass("priceAction"));
    expect(andRes.pass).toBe(pass("freshCross") && pass("priceAction"));
  });

  it("grouped members are not judged by the flat rules; a failing group blocks the signal", () => {
    const ev = last(cfgWith([{ id: "trend", op: "AND", members: ["trendFilter", "emaSlope"] }]));
    const groupPass = ev.groups[0].pass;
    expect(ev.failedMandatory.includes("group:trend")).toBe(!groupPass);
    expect(ev.failedMandatory.includes("trendFilter")).toBe(false);
    expect(ev.failedMandatory.includes("emaSlope")).toBe(false);
    if (!groupPass) expect(ev.signal).toBe("WAIT");
  });

  it("no groups behaves exactly like the flat rules", () => {
    const ev = last(cfgWith([]));
    expect(ev.groups).toEqual([]);
    expect(ev.failedMandatory.every((id) => !id.startsWith("group:"))).toBe(true);
  });
});

import request from "supertest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32) }));

describe("scanner accepts and validates groups", () => {
  it("accepts a valid AND/OR group", async () => {
    const res = await request(app).post("/api/v1/scanner/run").send({ interval: "5", config: { groups: [{ id: "entry", op: "OR", members: ["freshCross", "priceAction"] }] } });
    expect(res.status).toBe(200);
  });
  it("rejects grouping the always-mandatory risk plan", async () => {
    const res = await request(app).post("/api/v1/scanner/run").send({ interval: "5", config: { groups: [{ id: "x", op: "AND", members: ["riskPlan"] }] } });
    expect(res.status).toBe(400);
  });
  it("rejects a condition placed in two groups", async () => {
    const res = await request(app).post("/api/v1/scanner/run").send({ interval: "5", config: { groups: [
      { id: "a", op: "OR", members: ["adx"] }, { id: "b", op: "AND", members: ["adx", "macd"] }] } });
    expect(res.status).toBe(400);
  });
});

describe("backtest accepts groups", () => {
  const H = { "X-Admin-Token": "test-admin-token-123456" };
  it("runs a backtest with an AND/OR group", async () => {
    const res = await request(app).post("/api/v1/backtests").set(H).send({ symbol: "RELIANCE", days: 20, interval: "5", config: { groups: [{ id: "entry", op: "OR", members: ["freshCross", "priceAction"] }] } });
    expect(res.status).toBe(201);
    expect(res.body.metrics).toBeDefined();
  });
  it("rejects an invalid group on backtests", async () => {
    const res = await request(app).post("/api/v1/backtests").set(H).send({ symbol: "RELIANCE", config: { groups: [{ id: "x", op: "AND", members: ["dataSufficiency"] }] } });
    expect(res.status).toBe(400);
  });
  it("still requires the admin token", async () => {
    const res = await request(app).post("/api/v1/backtests").send({ symbol: "RELIANCE" });
    expect(res.status).toBe(401);
  });
});

describe("active strategy", () => {
  const H = { "X-Admin-Token": "test-admin-token-123456" };
  it("requires the admin token to set it", async () => {
    const res = await request(app).put("/api/v1/strategies/active").send({ rsiMin: 50 });
    expect(res.status).toBe(401);
  });
  it("sets groups that every page then uses", async () => {
    const set = await request(app).put("/api/v1/strategies/active").set(H).send({ groups: [{ id: "entry", op: "OR", members: ["freshCross", "priceAction"] }] });
    expect(set.status).toBe(200);
    const cur = await request(app).get("/api/v1/strategies");
    expect(cur.body.config.groups).toHaveLength(1);
    expect(cur.body.config.groups[0].id).toBe("entry");
  });
  it("rejects an invalid active strategy", async () => {
    const res = await request(app).put("/api/v1/strategies/active").set(H).send({ groups: [{ id: "x", op: "AND", members: ["riskPlan"] }] });
    expect(res.status).toBe(400);
  });
  it("clears back to defaults", async () => {
    await request(app).put("/api/v1/strategies/active").set(H).send({});
    const cur = await request(app).get("/api/v1/strategies");
    expect(cur.body.config.groups).toEqual([]);
  });
});
