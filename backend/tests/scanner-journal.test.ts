import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const TOKEN = "test-admin-token-123456";
const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) }));

describe("scanner builder overrides", () => {
  it("rejects rsiMin above rsiMax", async () => {
    const res = await request(app).post("/api/v1/scanner/run").send({ config: { rsiMin: 80, rsiMax: 60 } });
    expect(res.status).toBe(400);
  });
  it("rejects unknown condition ids", async () => {
    const res = await request(app).post("/api/v1/scanner/run").send({ config: { conditions: { madeUp: { enabled: true, mandatory: true } } } });
    expect(res.status).toBe(400);
  });
  it("applies overrides and reports the applied config", async () => {
    const res = await request(app).post("/api/v1/scanner/run").send({ config: { minAdx: 35, conditions: { adx: { enabled: true, mandatory: false } } } });
    expect(res.status).toBe(200);
    expect(res.body.appliedConfig.minAdx).toBe(35);
    expect(res.body.appliedConfig.conditions.adx.mandatory).toBe(false);
  });
});

describe("market overview and journal", () => {
  it("overview lists every sample instrument with a numeric change", async () => {
    const res = await request(app).get("/api/v1/market/overview");
    expect(res.body.items).toHaveLength(5);
    expect(Number.isFinite(res.body.items[0].changePct)).toBe(true);
  });
  it("journal note needs the admin token", async () => {
    const res = await request(app).put("/api/v1/journal/note").send({ key: "TCS:1", note: "x" });
    expect(res.status).toBe(401);
  });
  it("journal note for a trade that does not exist is 404", async () => {
    const res = await request(app).put("/api/v1/journal/note").set("X-Admin-Token", TOKEN).send({ key: "TCS:1", note: "x" });
    expect(res.status).toBe(404);
  });
  it("journal list is public and returns an array", async () => {
    const res = await request(app).get("/api/v1/journal");
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
