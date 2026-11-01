import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { sampleCandles } from "../src/data/sample.js";
import { aggregateDaily } from "../src/domain/candles.js";

const TOKEN = "test-admin-token-123456";
const env = () => loadEnv({
  NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32),
  KITE_API_KEY: "api_key_example", KITE_API_SECRET: "secret_example", KITE_REDIRECT_URL: "https://example.test/api/v1/broker/callback",
});
const HDR = "instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange";
const CSV = [HDR,
  "738561,1333,RELIANCE,RELIANCE,0,,0,0.05,1,EQ,NSE,NSE",
  "2953217,11536,TCS,TCS,0,,0,0.05,1,EQ,NSE,NSE",
  "408065,1594,INFY,INFOSYS,0,,0,0.05,1,EQ,NSE,NSE",
  "341249,1333,HDFCBANK,HDFC BANK,0,,0,0.05,1,EQ,NSE,NSE",
  "1270529,4963,ICICIBANK,ICICI BANK,0,,0,0.05,1,EQ,NSE,NSE",
  "256265,1001,NIFTY 50,NIFTY 50,0,,0,0,1,EQ,INDICES,NSE",
].join("\n") + "\n";

function serve(opts: { profile?: number; quote?: boolean } = {}) {
  const rows = (cs: ReturnType<typeof sampleCandles>) => cs.map((c) => [new Date(c.time + 19_800_000).toISOString().slice(0, 19) + "+0530", c.open, c.high, c.low, c.close, c.volume]);
  const minute = rows(sampleCandles("RELIANCE", 2, 2800));
  const daily = rows(aggregateDaily(sampleCandles("RELIANCE", 30, 2800)));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.kite.trade/session/token")) return new Response(JSON.stringify({ status: "success", data: { access_token: "AT", user_id: "U1" } }), { status: 200 });
    if (url === "https://api.kite.trade/user/profile") return new Response(JSON.stringify({ status: "success", data: { user_id: "AB1234" } }), { status: opts.profile ?? 200 });
    if (url === "https://api.kite.trade/instruments/NSE") return new Response(CSV, { status: 200 });
    if (url.startsWith("https://api.kite.trade/quote")) return new Response(JSON.stringify({ status: "success", data: opts.quote === false ? {} : { "NSE:RELIANCE": { last_price: 2850.5, ohlc: { close: 2840 } } } }), { status: 200 });
    if (url.includes("/instruments/historical/")) return new Response(JSON.stringify({ status: "success", data: { candles: url.includes("/day") ? daily : minute } }), { status: 200 });
    return new Response("{}", { status: 404 });
  });
}

describe("Kite connection diagnostic and live indices", () => {
  afterEach(() => vi.restoreAllMocks());

  it("says to log in when there is no session", async () => {
    const { app } = createApp(env());
    const r = await request(app).get("/api/v1/broker/diagnose").set({ "X-Admin-Token": TOKEN });
    expect(r.body.connected).toBe(false);
    expect(r.body.checks).toEqual([]);
  });

  it("runs every check after login and reports each result", async () => {
    const { app } = createApp(env());
    serve();
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    const r = await request(app).get("/api/v1/broker/diagnose").set({ "X-Admin-Token": TOKEN });
    expect(r.body.checks.map((c: { name: string }) => c.name)).toEqual(["Profile", "Instrument list", "Quote RELIANCE", "1-minute history RELIANCE (1 day)", "Index history NIFTY 50 (1 day)"]);
    expect(r.body.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(r.body.checks[1].detail).toMatch(/5 NSE equities/);
  });

  it("reports a failed check with Kite's reason instead of hiding it", async () => {
    const { app } = createApp(env());
    serve({ quote: false });
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    const r = await request(app).get("/api/v1/broker/diagnose").set({ "X-Admin-Token": TOKEN });
    const quote = r.body.checks.find((c: { name: string }) => c.name === "Quote RELIANCE");
    expect(quote.ok).toBe(false);
    expect(quote.detail).toMatch(/No quote/);
  });

  it("serves NIFTY 50 from Kite history when logged in", async () => {
    const { app } = createApp(env());
    serve();
    await request(app).post("/api/v1/broker/session").set({ "X-Admin-Token": TOKEN }).send({ requestToken: "REQ123456" });
    const r = await request(app).get("/api/v1/indices/NIFTY%2050/chart?interval=5&days=2");
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("KITE");
    expect(r.body.candles.length).toBeGreaterThan(0);
  });
});
