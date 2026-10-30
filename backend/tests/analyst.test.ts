import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32) }));

describe("rule-based analyst", () => {
  it("returns a labelled rule-based summary with a disclaimer, never claiming AI", async () => {
    const res = await request(app).get("/api/v1/analyst/TCS");
    expect(res.status).toBe(200);
    expect(res.body.method).toBe("rule-based");
    expect(res.body.summary.length).toBeGreaterThanOrEqual(3);
    expect(res.body.disclaimer).toMatch(/not AI analysis/);
  });
  it("rejects unknown symbols", async () => {
    expect((await request(app).get("/api/v1/analyst/NOPE")).status).toBe(404);
  });
});
