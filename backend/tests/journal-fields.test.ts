import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const TOKEN = "test-admin-token-123456";
const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) }));
const H = { "X-Admin-Token": TOKEN };

describe("journal carries strategy and entry reason", () => {
  it("records the manual order's strategy and entry reason on the closed trade", async () => {
    const placed = await request(app).post("/api/v1/paper/order").set(H).send({ symbol: "HDFCBANK", qty: 1, stop: 0.01, target: 1e9 });
    expect(placed.status).toBe(201);
    expect(placed.body.strategy).toBe("Manual order");
    await request(app).post("/api/v1/paper/emergency-stop").set(H).send({ active: true });
    const journal = await request(app).get("/api/v1/journal");
    const item = journal.body.items.find((t: { symbol: string }) => t.symbol === "HDFCBANK");
    expect(item).toBeTruthy();
    expect(item.reason).toBe("EMERGENCY_FLATTEN");
    expect(item.strategy).toBe("Manual order");
    expect(item.entryReason).toMatch(/Paper Trading page/);
  });
});
