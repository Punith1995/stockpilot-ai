import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32) }));

describe("market quotes", () => {
  it("defaults to SAMPLE with a reason when Kite is not connected", async () => {
    const res = await request(app).get("/api/v1/market/quotes");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("SAMPLE");
    expect(res.body.fallbackReason).toMatch(/Kite is not connected/);
  });
  it("returns the four dashboard indices with finite numbers", async () => {
    const res = await request(app).get("/api/v1/market/quotes");
    expect(res.body.indices.map((i: { symbol: string }) => i.symbol)).toEqual(["NIFTY 50", "NIFTY BANK", "SENSEX", "NIFTY MIDCAP 100"]);
    for (const i of res.body.indices) expect(Number.isFinite(i.last) && Number.isFinite(i.changePct)).toBe(true);
  });
  it("breadth counts add up to the number of stocks", async () => {
    const res = await request(app).get("/api/v1/market/quotes");
    const b = res.body.breadth;
    expect(b.advancing + b.declining + b.unchanged).toBe(res.body.stocks.length);
    expect(res.body.topGainers.length).toBeLessThanOrEqual(5);
  });
});
