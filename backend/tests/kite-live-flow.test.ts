import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const TOKEN = "test-admin-token-123456";
const env = () => loadEnv({
  NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32),
  KITE_API_KEY: "api_key_example", KITE_API_SECRET: "secret_example", KITE_REDIRECT_URL: "https://example.test/api/v1/broker/callback",
});
const CSV = [
  "instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange",
  "738561,1333,RELIANCE,RELIANCE,0,,0,0.05,1,EQ,NSE,NSE",
  "2953217,11536,TCS,TCS,0,,0,0.05,1,EQ,NSE,NSE",
  "408065,1594,INFY,INFOSYS,0,,0,0.05,1,EQ,NSE,NSE",
  "341249,1333,HDFCBANK,HDFC BANK,0,,0,0.05,1,EQ,NSE,NSE",
  "1270529,4963,ICICIBANK,ICICI BANK,0,,0,0.05,1,EQ,NSE,NSE",
].join("\n") + "\n";
const candleRows = [
  ["2026-10-30T09:15:00+0530", 1500, 1510, 1495, 1505, 1000],
  ["2026-10-30T09:20:00+0530", 1505, 1512, 1502, 1510, 900],
  ["2026-10-30T09:25:00+0530", 1510, 1515, 1508, 1513, 800],
];

/** Routes each Kite URL to a canned answer. `historicalStatus` lets a test simulate an expired session. */
function mockKite(historicalStatus = 200) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://api.kite.trade/session/token")) return new Response(JSON.stringify({ status: "success", data: { access_token: "AT_TEST", user_id: "U1" } }), { status: 200 });
    if (url === "https://api.kite.trade/instruments/NSE") return new Response(CSV, { status: 200 });
    if (url.includes("/instruments/historical/")) {
      if (historicalStatus !== 200) return new Response("{}", { status: historicalStatus });
      return new Response(JSON.stringify({ status: "success", data: { candles: candleRows } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  return calls;
}

describe("Kite live flow", () => {
  afterEach(() => vi.restoreAllMocks());

  it("switches status and chart to live Kite data after the session is exchanged", async () => {
    const { app } = createApp(env());
    const calls = mockKite();
    const before = await request(app).get("/api/v1/status");
    expect(before.body.dataSource).toBe("SAMPLE");
    const ex = await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    expect(ex.status).toBe(201);
    const after = await request(app).get("/api/v1/status");
    expect(after.body.dataSource).toBe("KITE");
    const chart = await request(app).get("/api/v1/chart/INFY?interval=5&days=2");
    expect(chart.body.source).toBe("KITE");
    expect(chart.body.candles.length).toBe(3);
    const hist = calls.find((u) => u.includes("/instruments/historical/408065/minute"));
    expect(hist).toBeTruthy();
    const from = decodeURIComponent(new URL(hist!).searchParams.get("from") ?? "");
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("takes the request token automatically from Kite's redirect and returns to the app connected", async () => {
    const { app } = createApp(env());
    mockKite();
    const r = await request(app).get("/api/v1/broker/callback?status=success&request_token=REQ123456");
    expect(r.status).toBe(302);
    expect(r.headers.location).toMatch(/\/connection\?kite=connected$/);
    expect((await request(app).get("/api/v1/broker/status")).body.connected).toBe(true);
    expect((await request(app).get("/api/v1/status")).body.dataSource).toBe("KITE");
  });

  it("falls back to SAMPLE with a reason when the session has expired", async () => {
    const { app } = createApp(env());
    mockKite(403);
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    const chart = await request(app).get("/api/v1/chart/INFY?interval=5&days=2");
    expect(chart.body.source).toBe("SAMPLE");
    expect(chart.body.note).toMatch(/expired/);
    expect((await request(app).get("/api/v1/status")).body.dataSource).toBe("SAMPLE");
  });

  it("builds every chart interval, including 3 minute, from the same live 1-minute bars", async () => {
    const { app } = createApp(env());
    const calls = mockKite();
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    const chart = await request(app).get("/api/v1/chart/INFY?interval=3&days=2");
    expect(chart.body.source).toBe("KITE");
    expect(chart.body.note).toMatch(/1-minute/);
    expect(calls.filter((u) => u.includes("/instruments/historical/408065/minute")).length).toBeGreaterThan(0);
    const again = await request(app).get("/api/v1/chart/INFY?interval=5&days=2");
    expect(again.body.source).toBe("KITE");
  });
});
