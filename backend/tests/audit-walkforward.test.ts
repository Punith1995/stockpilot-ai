import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { AuditLog } from "../src/audit/log.js";
import { splitByDay } from "../src/backtest/engine.js";
import { sampleCandles } from "../src/data/sample.js";
import { istParts } from "../src/domain/candles.js";

const TOKEN = "test-admin-token-123456";
const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) }));

describe("walk-forward split", () => {
  const candles = sampleCandles("TCS", 60, 3900);
  it("never shares an IST session between in-sample and out-of-sample", () => {
    const { inSample, outOfSample } = splitByDay(candles, 0.3);
    const isDays = new Set(inSample.map((c) => istParts(c.time).dayKey));
    const oosDays = new Set(outOfSample.map((c) => istParts(c.time).dayKey));
    for (const d of oosDays) expect(isDays.has(d)).toBe(false);
    expect(inSample.length + outOfSample.length).toBe(candles.length);
    expect(outOfSample.length).toBeGreaterThan(0);
    expect(inSample.length).toBeGreaterThan(outOfSample.length);
  });
  it("returns everything in-sample when the fraction is zero", () => {
    expect(splitByDay(candles, 0).outOfSample.length).toBe(0);
  });
  it("the walk-forward backtest reports both halves with a stability note", async () => {
    const res = await request(app).post("/api/v1/backtests").set("X-Admin-Token", TOKEN).send({ symbol: "TCS", days: 40, oosFraction: 0.3 });
    expect(res.status).toBe(201);
    expect(res.body.walkForward.inSample.metrics).toHaveProperty("trades");
    expect(res.body.walkForward.outOfSample.metrics).toHaveProperty("trades");
    expect(res.body.walkForward.note).toMatch(/not a proof/);
  });
});

describe("audit log", () => {
  it("keeps only the newest entries and never stores more than the bound", () => {
    const log = new AuditLog(3);
    for (let i = 0; i < 5; i++) log.record(`action.${i}`);
    const items = log.list();
    expect(items).toHaveLength(3);
    expect(items[0].action).toBe("action.4");
  });
  it("is admin-only", async () => {
    expect((await request(app).get("/api/v1/audit")).status).toBe(401);
  });
  it("records admin actions without the token value", async () => {
    await request(app).post("/api/v1/paper/scan").set("X-Admin-Token", TOKEN);
    const res = await request(app).get("/api/v1/audit").set("X-Admin-Token", TOKEN);
    expect(res.body.items.some((i: { action: string }) => i.action === "paper.scan")).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });
});

describe("risk limits view", () => {
  it("returns configured limits and current paper state", async () => {
    const res = await request(app).get("/api/v1/risk/limits");
    expect(res.status).toBe(200);
    expect(res.body.limits.maxOpenPositions).toBeGreaterThan(0);
    expect(res.body.current.emergencyStop).toBe(false);
  });
});
