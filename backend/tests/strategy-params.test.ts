import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const TOKEN = "test-admin-token-123456";
const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) }));
const H = { "X-Admin-Token": TOKEN };

describe("editable strategy parameters", () => {
  it("saves target multiple and max hold for a simple strategy and shows them in the registry", async () => {
    const before = await request(app).get("/api/v1/strategy-registry");
    const row = before.body.items.find((i: { id: string }) => i.id === "ema-crossover");
    expect(row.editable).toBe(true);
    const put = await request(app).put("/api/v1/strategy-params/ema-crossover").set(H).send({ targetR: 2.5, maxHoldBars: 40 });
    expect(put.status).toBe(200);
    expect(put.body.params).toMatchObject({ targetR: 2.5, maxHoldBars: 40, edited: true });
    const after = await request(app).get("/api/v1/strategy-registry");
    expect(after.body.items.find((i: { id: string }) => i.id === "ema-crossover").params.targetR).toBe(2.5);
  });
  it("saves the ATR stop multiple for an ATR-stop strategy", async () => {
    const put = await request(app).put("/api/v1/strategy-params/rsi2-pullback").set(H).send({ stopAtr: 1.2 });
    expect(put.status).toBe(200);
    expect(put.body.params.stopAtr).toBe(1.2);
  });
  it("refuses the built-in strategy, unknown ids, out-of-range values and anonymous edits", async () => {
    expect((await request(app).put("/api/v1/strategy-params/ema-momentum-pro").set(H).send({ targetR: 2 })).status).toBe(400);
    expect((await request(app).put("/api/v1/strategy-params/nope").set(H).send({ targetR: 2 })).status).toBe(404);
    expect((await request(app).put("/api/v1/strategy-params/ema-crossover").set(H).send({ targetR: 99 })).status).toBe(400);
    expect((await request(app).put("/api/v1/strategy-params/ema-crossover").send({ targetR: 2 })).status).toBe(401);
  });
});
