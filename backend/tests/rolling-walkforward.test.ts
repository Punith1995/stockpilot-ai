import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const TOKEN = "test-admin-token-123456";
const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) }));
const H = { "X-Admin-Token": TOKEN };

describe("rolling walk-forward", () => {
  it("returns one row per fold with sessions covering the period", async () => {
    const r = await request(app).post("/api/v1/backtests").set(H).send({ symbol: "TCS", strategyId: "ema-crossover", days: 30, interval: "15", folds: 3 });
    expect(r.status).toBe(201);
    expect(r.body.rolling.folds).toHaveLength(3);
    expect(r.body.rolling.folds.reduce((s: number, f: { sessions: number }) => s + f.sessions, 0)).toBeGreaterThan(0);
    expect(typeof r.body.rolling.positiveFolds).toBe("number");
  });
  it("is off by default and rejects too many folds", async () => {
    const off = await request(app).post("/api/v1/backtests").set(H).send({ symbol: "TCS", strategyId: "ema-crossover", days: 20, interval: "15" });
    expect(off.body.rolling).toBeNull();
    const bad = await request(app).post("/api/v1/backtests").set(H).send({ symbol: "TCS", strategyId: "ema-crossover", days: 20, interval: "15", folds: 9 });
    expect(bad.status).toBe(400);
  });
});
