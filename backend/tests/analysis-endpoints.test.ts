import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32) }));

describe("analysis endpoints", () => {
  it("indicator values are numbers or null, never NaN", async () => {
    const res = await request(app).get("/api/v1/indicators/TCS");
    expect(res.status).toBe(200);
    for (const v of Object.values(res.body.values)) {
      expect(v === null || (typeof v === "number" && Number.isFinite(v))).toBe(true);
    }
    expect(res.body.values.ema20).not.toBeNull();
  });
  it("multi-timeframe returns all nine timeframes with computed values and a summary", async () => {
    const res = await request(app).get("/api/v1/mtf/INFY");
    expect(res.body.frames.map((f: { timeframe: string }) => f.timeframe)).toEqual(["1", "3", "5", "10", "15", "30", "60", "240", "D"]);
    expect(["Bullish", "Bearish", "Sideways", "Unknown"]).toContain(res.body.frames[0].trend);
    expect(typeof res.body.frames[0].ema200).toBe("number");
    expect(typeof res.body.frames[0].adx14).toBe("number");
    expect(res.body.summary.totalFrames).toBe(9);
  });
  it("data quality reports kept and dropped counts that add up", async () => {
    const res = await request(app).get("/api/v1/data/quality/RELIANCE");
    expect(res.body.kept + res.body.dropped).toBe(res.body.received);
  });
  it("live status keeps live trading disabled and lists failing gates", async () => {
    const res = await request(app).get("/api/v1/live/status");
    expect(res.body.enabled).toBe(false);
    expect(res.body.gates.some((g: { ok: boolean }) => g.ok === false)).toBe(true);
  });
});
