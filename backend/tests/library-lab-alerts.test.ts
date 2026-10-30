import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { AlertStore } from "../src/alerts/store.js";

const TOKEN = "test-admin-token-123456";
const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) }));
const auth = (r: request.Test) => r.set("X-Admin-Token", TOKEN);

describe("strategy library", () => {
  it("lists the built-in strategy and saves presets only with the admin token", async () => {
    const lib = await request(app).get("/api/v1/strategy-library");
    expect(lib.body.builtIn.builtIn).toBe(true);
    expect((await request(app).post("/api/v1/strategy-library").send({ name: "x", overrides: {} })).status).toBe(401);
    const saved = await auth(request(app).post("/api/v1/strategy-library")).send({ name: "tight ADX", overrides: { minAdx: 30 } });
    expect(saved.status).toBe(201);
  });
  it("rejects a preset with rsiMin above rsiMax", async () => {
    const res = await auth(request(app).post("/api/v1/strategy-library")).send({ name: "bad", overrides: { rsiMin: 80, rsiMax: 60 } });
    expect(res.status).toBe(400);
  });
});

describe("strategy lab", () => {
  it("ranks the grid by out-of-sample profit and always carries the overfitting warning", async () => {
    const res = await auth(request(app).post("/api/v1/strategy-lab/sweep")).send({ symbol: "TCS", days: 40, targetR: [1.5, 2], atrMultiple: [1, 1.5] });
    expect(res.status).toBe(200);
    expect(res.body.combinations).toBe(4);
    expect(res.body.rows).toHaveLength(4);
    for (let i = 1; i < res.body.rows.length; i++) {
      expect(res.body.rows[i - 1].outOfSample.netProfit).toBeGreaterThanOrEqual(res.body.rows[i].outOfSample.netProfit);
    }
    expect(res.body.warning).toMatch(/likely optimistic/);
  });
  it("refuses grids larger than 9 combinations", async () => {
    const res = await auth(request(app).post("/api/v1/strategy-lab/sweep")).send({ symbol: "TCS", targetR: [1, 2, 3], atrMultiple: [1, 1.5, 2, 2.5] });
    expect(res.status).toBe(400);
  });
});

describe("alerts", () => {
  it("creates, lists and deletes rules with the admin token", async () => {
    const created = await auth(request(app).post("/api/v1/alerts")).send({ symbol: "INFY", type: "PRICE_ABOVE", value: 100 });
    expect(created.status).toBe(201);
    const list = await request(app).get("/api/v1/alerts");
    expect(list.body.items.some((r: { id: string }) => r.id === created.body.id)).toBe(true);
    expect((await auth(request(app).delete(`/api/v1/alerts/${created.body.id}`))).status).toBe(204);
  });
  it("price alerts need a value", async () => {
    const res = await auth(request(app).post("/api/v1/alerts")).send({ symbol: "INFY", type: "PRICE_BELOW" });
    expect(res.status).toBe(400);
  });
  it("a price-above alert with an impossible level does not fire", async () => {
    const created = await auth(request(app).post("/api/v1/alerts")).send({ symbol: "INFY", type: "PRICE_ABOVE", value: 1e9 });
    const check = await auth(request(app).post("/api/v1/alerts/check"));
    expect(check.body.fired).not.toContain(created.body.id);
  });
  it("alert store keeps only the newest 200 notifications", () => {
    const s = new AlertStore();
    for (let i = 0; i < 210; i++) s.notify({ ruleId: "A1", symbol: "X", message: String(i) });
    expect(s.notifications).toHaveLength(200);
    expect(s.notifications[0].message).toBe("10");
  });
});
