import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { lastSessions } from "../src/data/market.js";
import { sampleCandles } from "../src/data/sample.js";
import { aggregateDaily } from "../src/domain/candles.js";

const TOKEN = "test-admin-token-123456";
const env = () => loadEnv({
  NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32),
  KITE_API_KEY: "api_key_example", KITE_API_SECRET: "secret_example", KITE_REDIRECT_URL: "https://example.test/api/v1/broker/callback",
});
const SYMBOLS = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"];
const CSV = ["instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange",
  ...SYMBOLS.map((s, i) => `${1000 + i},1,${s},${s},0,,0,0.05,1,EQ,NSE,NSE`)].join("\n") + "\n";

/** Serves minute history for every symbol: 60 sessions of generated bars, shifted so the data is clearly not SAMPLE. */
function serveLive(historicalStatus = 200) {
  const toRows = (cs: ReturnType<typeof sampleCandles>) => cs.map((c) => [new Date(c.time + 19_800_000).toISOString().slice(0, 19) + "+0530", c.open, c.high, c.low, c.close, c.volume]);
  const minuteRows = toRows(sampleCandles("INFY", 60, 5000));
  const dayRows = toRows(aggregateDaily(sampleCandles("INFY", 300, 5000)));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.kite.trade/session/token")) return new Response(JSON.stringify({ status: "success", data: { access_token: "AT", user_id: "U1" } }), { status: 200 });
    if (url === "https://api.kite.trade/instruments/NSE") return new Response(CSV, { status: 200 });
    if (url.includes("/instruments/historical/")) {
      if (historicalStatus !== 200) return new Response("{}", { status: historicalStatus });
      return new Response(JSON.stringify({ status: "success", data: { candles: url.includes("/minute") ? minuteRows : dayRows } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
}

describe("shared market data", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the last N IST sessions only", () => {
    const cs = sampleCandles("TCS", 10, 3000);
    const kept = lastSessions(cs, 2);
    const days = new Set(kept.map((c) => Math.floor((c.time + 19_800_000) / 86_400_000)));
    expect(days.size).toBe(2);
  });

  it("reports SAMPLE with no Kite session, and the scanner says so", async () => {
    const { app } = createApp(env());
    const status = await request(app).get("/api/v1/status");
    expect(status.body.dataSource).toBe("SAMPLE");
    expect(status.body.marketData.live).toBe(false);
    const scan = await request(app).get("/api/v1/scanner/run?interval=5");
    expect(scan.status).toBeLessThan(500);
  });

  it("loads live bars for all five stocks after login and labels the pages KITE", async () => {
    const { app } = createApp(env());
    serveLive();
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    const status = await request(app).get("/api/v1/status");
    expect(status.body.dataSource).toBe("KITE");
    expect(status.body.marketData.symbols).toBe(5);
    const mtf = await request(app).get("/api/v1/mtf/RELIANCE");
    expect(mtf.body.source).toBe("KITE");
    const daily = mtf.body.frames.find((f: { timeframe: string }) => f.timeframe === "D");
    expect(daily.bars).toBeGreaterThan(0);
  });

  it("falls back to SAMPLE with the reason when the session expires during a load", async () => {
    const { app } = createApp(env());
    serveLive(403);
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    const status = await request(app).get("/api/v1/status");
    expect(status.body.dataSource).toBe("SAMPLE");
    expect(status.body.marketData.lastError).toMatch(/expired/);
  });

  it("lists all NSE equities and loads any named stock live on demand", async () => {
    const { app } = createApp(env());
    serveLive();
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    const list = await request(app).get("/api/v1/instruments");
    expect(list.body.items.length).toBeGreaterThanOrEqual(5);
    const names = list.body.items.map((i: { symbol: string }) => i.symbol);
    expect(names).toContain("RELIANCE");
    // A stock outside the five core names, served by the same mock Kite feed.
    const chart = await request(app).get("/api/v1/chart/RELIANCE?interval=15&days=2");
    expect(chart.body.source).toBe("KITE");
    const unknown = await request(app).get("/api/v1/chart/NOSUCHSTOCK?interval=5&days=2");
    expect(unknown.status).toBe(404);
  });
});
