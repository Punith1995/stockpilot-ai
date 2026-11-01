import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const TOKEN = "test-admin-token-123456";
const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) }));
const H = { "X-Admin-Token": TOKEN };

describe("strategy registry", () => {
  it("lists the built-in strategy and the ten simple strategies, all enabled", async () => {
    const res = await request(app).get("/api/v1/strategy-registry");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(16);
    expect(res.body.items.every((i: { enabled: boolean }) => i.enabled)).toBe(true);
  });
  it("requires the admin token to change state", async () => {
    const res = await request(app).put("/api/v1/strategy-registry/supertrend").send({ enabled: false });
    expect(res.status).toBe(401);
  });
  it("rejects unknown strategy ids", async () => {
    const res = await request(app).put("/api/v1/strategy-registry/nope").set(H).send({ enabled: false });
    expect(res.status).toBe(404);
  });
  it("a disabled strategy cannot be backtested and is left out of the comparison", async () => {
    const off = await request(app).put("/api/v1/strategy-registry/supertrend").set(H).send({ enabled: false });
    expect(off.body.enabled).toBe(false);
    const bt = await request(app).post("/api/v1/backtests").set(H).send({ symbol: "RELIANCE", strategyId: "supertrend", days: 20, interval: "5" });
    expect(bt.status).toBe(409);
    const cmp = await request(app).post("/api/v1/strategies/compare").set(H).send({ symbol: "RELIANCE", days: 40, oosFraction: 0.3 });
    expect(cmp.status).toBe(200);
    expect(cmp.body.rows.some((r: { id: string }) => r.id === "supertrend")).toBe(false);
    expect(cmp.body.rows).toHaveLength(14);
    const on = await request(app).put("/api/v1/strategy-registry/supertrend").set(H).send({ enabled: true });
    expect(on.body.enabled).toBe(true);
    const bt2 = await request(app).post("/api/v1/backtests").set(H).send({ symbol: "RELIANCE", strategyId: "supertrend", days: 20, interval: "5" });
    expect(bt2.status).toBe(201);
  });
});
