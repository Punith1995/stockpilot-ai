import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const TOKEN = "test-admin-token-123456";
const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) }));

describe("five strategies API", () => {
  it("lists the ten strategies with the no-guarantee note", async () => {
    const res = await request(app).get("/api/v1/strategies/simple");
    expect(res.body.items).toHaveLength(15);
    expect(res.body.note).toMatch(/None is guaranteed/);
  });
  it("comparison needs the admin token", async () => {
    expect((await request(app).post("/api/v1/strategies/compare").send({ symbol: "TCS" })).status).toBe(401);
  });
  it("comparison ranks all ten by out-of-sample profit and carries the warning", async () => {
    const res = await request(app).post("/api/v1/strategies/compare").set("X-Admin-Token", TOKEN).send({ symbol: "TCS", days: 40 });
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(15);
    for (let i = 1; i < 10; i++) expect(res.body.rows[i - 1].outOfSample.netProfit).toBeGreaterThanOrEqual(res.body.rows[i].outOfSample.netProfit);
    expect(res.body.warning).toMatch(/not a prediction/);
  });
});
