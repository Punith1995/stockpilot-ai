import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { approxKiteExpiry } from "../src/broker/kite.js";

const TOKEN = "test-admin-token-123456";
const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) }));
const IST = 19_800_000;

describe("settings status", () => {
  it("expires a Kite session at 06:00 IST: next morning after 10:00 IST, same day before 06:00", () => {
    const at10 = Date.UTC(2026, 9, 31, 10, 0) - IST;
    expect(new Date(approxKiteExpiry(at10)).getTime()).toBe(Date.UTC(2026, 10, 1, 6, 0) - IST);
    const at03 = Date.UTC(2026, 9, 31, 3, 0) - IST;
    expect(new Date(approxKiteExpiry(at03)).getTime()).toBe(Date.UTC(2026, 9, 31, 6, 0) - IST);
  });
  it("reports the webhook setting, start time and recent errors without secrets", async () => {
    const s = await request(app).get("/api/v1/status");
    expect(s.body.alertWebhookConfigured).toBe(false);
    expect(typeof s.body.serverStartedAt).toBe("string");
    const e = await request(app).get("/api/v1/errors/recent");
    expect(Array.isArray(e.body.items)).toBe(true);
    expect(JSON.stringify(e.body)).not.toMatch(/ENCRYPTION_KEY|ADMIN_TOKEN/);
  });
});
