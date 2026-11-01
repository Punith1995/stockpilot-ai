import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32) }));

describe("scanner custom rules", () => {
  it("keeps stocks that pass every custom rule and drops the rest", async () => {
    const all = await request(app).post("/api/v1/scanner/run").send({});
    const pass = await request(app).post("/api/v1/scanner/run").send({ customRules: [{ left: "close", op: ">", right: { type: "value", value: 0.01 } }] });
    expect(pass.status).toBe(200);
    expect(pass.body.customApplied).toBe(true);
    expect(pass.body.count).toBe(all.body.count);
    const none = await request(app).post("/api/v1/scanner/run").send({ customRules: [{ left: "close", op: "<", right: { type: "value", value: 0.01 } }] });
    expect(none.body.count).toBe(0);
  });
  it("compares two indicators and rejects unknown indicator names", async () => {
    const r = await request(app).post("/api/v1/scanner/run").send({ customRules: [{ left: "ema20", op: ">=", right: { type: "indicator", name: "ema50" } }] });
    expect(r.status).toBe(200);
    expect(r.body.results.every((x: { custom?: { pass: boolean } }) => x.custom?.pass === true)).toBe(true);
    const bad = await request(app).post("/api/v1/scanner/run").send({ customRules: [{ left: "nope", op: ">", right: { type: "value", value: 1 } }] });
    expect(bad.status).toBe(400);
  });
});

describe("scanner match mode and saved scanners", () => {
  it("matches stocks passing any rule when customMatch is any", async () => {
    const all = await request(app).post("/api/v1/scanner/run").send({ customRules: [{ left: "close", op: "<", right: { type: "value", value: 0.01 } }, { left: "close", op: ">", right: { type: "value", value: 0.01 } }], customMatch: "any" });
    expect(all.body.count).toBe(all.body.scanned);
    const every = await request(app).post("/api/v1/scanner/run").send({ customRules: [{ left: "close", op: "<", right: { type: "value", value: 0.01 } }, { left: "close", op: ">", right: { type: "value", value: 0.01 } }], customMatch: "all" });
    expect(every.body.count).toBe(0);
  });
  it("saves and lists a scanner (admin only)", async () => {
    const H = { "X-Admin-Token": "test-admin-token-123456" };
    expect((await request(app).post("/api/v1/scanners").send({ name: "Trend" })).status).toBe(401);
    const saved = await request(app).post("/api/v1/scanners").set(H).send({ name: "Trend check", customRules: [{ left: "ema20", op: ">", right: { type: "indicator", name: "ema50" } }] });
    expect(saved.status).toBe(201);
    const list = await request(app).get("/api/v1/scanners");
    expect(list.body.items[0].name).toBe("Trend check");
  });
});
