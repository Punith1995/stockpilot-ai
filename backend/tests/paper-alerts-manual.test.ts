import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const TOKEN = "test-admin-token-123456";
const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) }));
const H = { "X-Admin-Token": TOKEN };

describe("manual simulated paper orders", () => {
  it("fills a valid order and refuses a stop above the price", async () => {
    const ok = await request(app).post("/api/v1/paper/order").set(H).send({ symbol: "INFY", qty: 1, stop: 0.01, target: 1e9 });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe("FILLED");
    const bad = await request(app).post("/api/v1/paper/order").set(H).send({ symbol: "TCS", qty: 1, stop: 1e9, target: 1e10 });
    expect(bad.status).toBe(409);
  });
  it("refuses a second position in a stock already held and needs the admin token", async () => {
    const dup = await request(app).post("/api/v1/paper/order").set(H).send({ symbol: "INFY", qty: 1, stop: 0.01, target: 1e9 });
    expect(dup.status).toBe(409);
    const anon = await request(app).post("/api/v1/paper/order").send({ symbol: "TCS", qty: 1, stop: 0.01, target: 1e9 });
    expect(anon.status).toBe(401);
  });
});

describe("alerts can be disabled and edited", () => {
  it("skips disabled rules when checking, and requires the admin token to edit", async () => {
    const created = await request(app).post("/api/v1/alerts").set(H).send({ symbol: "INFY", type: "PRICE_ABOVE", value: 1 });
    const id = created.body.id;
    expect(created.body.enabled).toBe(true);
    const anon = await request(app).put(`/api/v1/alerts/${id}`).send({ enabled: false });
    expect(anon.status).toBe(401);
    const off = await request(app).put(`/api/v1/alerts/${id}`).set(H).send({ enabled: false });
    expect(off.body.enabled).toBe(false);
    const check = await request(app).post("/api/v1/alerts/check").set(H);
    expect(check.body.fired).not.toContain(id);
  });
});
