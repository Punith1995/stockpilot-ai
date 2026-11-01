import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32) }));

describe("chart series endpoint", () => {
  it("returns candles and indicator arrays of equal length", async () => {
    const res = await request(app).get("/api/v1/chart/RELIANCE?interval=5&days=20");
    expect(res.status).toBe(200);
    const n = res.body.candles.length;
    expect(n).toBeGreaterThan(50);
    for (const k of ["ema20", "ema50", "rsi14", "macd", "macdSignal"]) expect(res.body[k]).toHaveLength(n);
  });
  it("rejects unknown symbols", async () => {
    expect((await request(app).get("/api/v1/chart/NOPE")).status).toBe(404);
  });
});
