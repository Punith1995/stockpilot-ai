import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const TOKEN = "test-admin-token-123456";
const env = loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32), FRONTEND_URL: "http://localhost:5173", KITE_API_KEY: "abc123", KITE_API_SECRET: "sec456", KITE_REDIRECT_URL: "https://example.com/api/v1/broker/callback" });
const { app } = createApp(env);

describe("kite callback", () => {
  it("sends the person back to the app when login was not successful", async () => {
    const res = await request(app).get("/api/v1/broker/callback?status=cancelled");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:5173/connection?kite=failed");
  });
  it("rejects a malformed request_token without calling Kite", async () => {
    const res = await request(app).get("/api/v1/broker/callback?status=success&request_token=bad%20token");
    expect(res.headers.location).toBe("http://localhost:5173/connection?kite=failed");
  });
  it("login URL carries only the public api_key, never the secret", async () => {
    const res = await request(app).get("/api/v1/broker/login-url");
    expect(res.body.url).toContain("api_key=abc123");
    expect(res.body.url).not.toContain("sec456");
  });
});
