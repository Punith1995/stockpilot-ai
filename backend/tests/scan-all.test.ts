import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { sampleCandles } from "../src/data/sample.js";

const TOKEN = "test-admin-token-123456";
const env = () => loadEnv({
  NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32),
  KITE_API_KEY: "api_key_example", KITE_API_SECRET: "secret_example", KITE_REDIRECT_URL: "https://example.test/api/v1/broker/callback",
});
const SYMBOLS = ["AAA", "BBB", "CCC", "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"];
const CSV = ["instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange",
  ...SYMBOLS.map((s, i) => `${2000 + i},1,${s},${s},0,,0,0.05,1,EQ,NSE,NSE`), "9,1,NIFTY,NIFTY,0,,0,0.05,1,IDX,NSE,NSE"].join("\n") + "\n";

function serveKite(historicalStatus = 200) {
  const rows = sampleCandles("AAA", 60, 800).map((c) => [new Date(c.time + 19_800_000).toISOString().slice(0, 19) + "+0530", c.open, c.high, c.low, c.close, c.volume]);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.kite.trade/session/token")) return new Response(JSON.stringify({ status: "success", data: { access_token: "AT", user_id: "U1" } }), { status: 200 });
    if (url === "https://api.kite.trade/instruments/NSE") return new Response(CSV, { status: 200 });
    if (url.includes("/instruments/historical/")) return historicalStatus !== 200 ? new Response("{}", { status: historicalStatus }) : new Response(JSON.stringify({ status: "success", data: { candles: rows } }), { status: 200 });
    return new Response("{}", { status: 404 });
  });
}

async function waitDone(app: ReturnType<typeof createApp>["app"]) {
  for (let i = 0; i < 100; i++) {
    const r = await request(app).get("/api/v1/scanner/scan-all");
    if (r.body.job && r.body.job.status !== "running") return r.body.job;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("scan did not finish");
}

describe("full NSE scan button", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses to scan before Kite is logged in", async () => {
    const { app } = createApp(env());
    const r = await request(app).post("/api/v1/scanner/scan-all").set({ "X-Admin-Token": TOKEN }).send({});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("KITE_NOT_CONNECTED");
  });

  it("scans every NSE equity after login and returns rows, skipping non-equity instruments", async () => {
    const { app } = createApp(env());
    serveKite();
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    const start = await request(app).post("/api/v1/scanner/scan-all").set({ "X-Admin-Token": TOKEN }).send({ interval: "5" });
    expect(start.status).toBe(202);
    const job = await waitDone(app);
    expect(job.status).toBe("done");
    expect(job.total).toBe(8);
    expect(job.done).toBe(8);
    expect(job.results.map((r: { symbol: string }) => r.symbol).sort()).toEqual([...SYMBOLS].sort());
  });

  it("stops the scan and reports the reason when the Kite session expires", async () => {
    const { app } = createApp(env());
    serveKite(200);
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    // First read loads the five core stocks while the session is still good.
    await request(app).get("/api/v1/status");
    vi.restoreAllMocks();
    serveKite(403);
    const start = await request(app).post("/api/v1/scanner/scan-all").set({ "X-Admin-Token": TOKEN }).send({});
    expect(start.status).toBe(202);
    const job = await waitDone(app);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/expired/);
  });

  it("serves a non-core stock as live Kite data, loaded when a request names it", async () => {
    const { app } = createApp(env());
    serveKite();
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    const chart = await request(app).get("/api/v1/chart/AAA?interval=5&days=2");
    expect(chart.status).toBe(200);
    expect(chart.body.source).toBe("KITE");
    expect(chart.body.candles.length).toBeGreaterThan(0);
  });

  it("closes a held non-core stock at its live price on emergency stop, not at its entry price", async () => {
    const { app } = createApp(env());
    serveKite();
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    const bars = await request(app).get("/api/v1/chart/AAA?interval=1&days=2");
    const last = bars.body.candles.at(-1).close as number;
    const order = await request(app).post("/api/v1/paper/order").set({ "X-Admin-Token": TOKEN }).send({ symbol: "AAA", qty: 1, stop: last * 0.9, target: last * 1.1 });
    expect(order.status).toBe(201);
    const stop = await request(app).post("/api/v1/paper/emergency-stop").set({ "X-Admin-Token": TOKEN }).send({ active: true });
    expect(stop.body.flattened).toBeGreaterThanOrEqual(0);
    expect(stop.body.flattened).toBe(1);
    const snap = await request(app).get("/api/v1/paper");
    const t = (snap.body.trades ?? []).find((x: { symbol: string }) => x.symbol === "AAA");
    expect(t).toBeTruthy();
    expect(t.exit).toBeCloseTo(last, 1);
    expect(t.reason).toBe("EMERGENCY_FLATTEN");
  });
});
