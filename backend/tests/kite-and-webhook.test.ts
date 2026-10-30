import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { chunkRange, parseCsv, parseKiteCandles, parseKiteTime, parseNseEquities, MAX_DAYS_PER_REQUEST } from "../src/data/kite-historical.js";

describe("CSV and instrument parsing", () => {
  it("handles quoted commas and escaped quotes", () => {
    const rows = parseCsv('a,b,c\n1,"Smith, John ""JJ""",3\n');
    expect(rows[1]).toEqual(["1", 'Smith, John "JJ"', "3"]);
  });
  it("keeps only NSE equities", () => {
    const csv = [
      "instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange",
      "738561,2885,RELIANCE,RELIANCE INDUSTRIES,0,,0,0.05,1,EQ,NSE,NSE",
      "1,1,NIFTYFUT,NIFTY,0,2026-12-31,0,0.05,50,FUT,NFO-FUT,NFO",
      "2,2,SBIN-BE,SBI,0,,0,0.05,1,EQ,NSE,NSE",
    ].join("\n");
    const list = parseNseEquities(csv);
    expect(list.map((i) => i.symbol)).toEqual(["RELIANCE", "SBIN-BE"]);
    expect(list[0].token).toBe(738561);
  });
  it("rejects a CSV with the wrong header", () => {
    expect(() => parseNseEquities("foo,bar\n1,2")).toThrow(/header/);
  });
});

describe("Kite candle handling", () => {
  it("parses +0530 timestamps as IST", () => {
    expect(parseKiteTime("2026-01-05T09:15:00+0530")).toBe(Date.UTC(2026, 0, 5, 3, 45));
  });
  it("rejects garbage timestamps instead of guessing", () => {
    expect(() => parseKiteTime("yesterday")).toThrow();
  });
  it("skips malformed rows and counts them", () => {
    const r = parseKiteCandles([["2026-01-05T09:15:00+0530", 1, 2, 0.5, 1.5, 100], ["bad"], ["nope", 1, 1, 1, 1, 1]]);
    expect(r.candles).toHaveLength(1);
    expect(r.skipped).toBe(2);
  });
  it("splits long ranges into windows within the interval limit", () => {
    const day = 86_400_000;
    const windows = chunkRange(0, 150 * day, MAX_DAYS_PER_REQUEST["1"]);
    expect(windows).toHaveLength(3);
    for (const w of windows) expect(w.to - w.from).toBeLessThanOrEqual(60 * day);
    expect(windows.at(-1)!.to).toBe(150 * day);
  });
});

describe("Kite routes without a session", () => {
  const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32) }));
  it("refuses to load instruments until Kite is logged in", async () => {
    const res = await request(app).post("/api/v1/data/kite/instruments").set("X-Admin-Token", "test-admin-token-123456");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("KITE_NOT_CONNECTED");
  });
  it("data source endpoint keeps SAMPLE as the default", async () => {
    const res = await request(app).get("/api/v1/data/source");
    expect(res.body.defaultSource).toBe("SAMPLE");
  });
});

describe("webhook alert delivery", () => {
  let server: http.Server | null = null;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  it("POSTs a fired alert to the configured webhook and records delivery", async () => {
    const received: unknown[] = [];
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => { received.push(JSON.parse(body)); res.writeHead(200).end("ok"); });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32), ALERT_WEBHOOK_URL: `http://127.0.0.1:${port}/hook` }));
    const auth = "test-admin-token-123456";
    await request(app).post("/api/v1/alerts").set("X-Admin-Token", auth).send({ symbol: "INFY", type: "PRICE_ABOVE", value: 0.01 });
    const check = await request(app).post("/api/v1/alerts/check").set("X-Admin-Token", auth);
    expect(check.body.fired.length).toBe(1);
    expect(check.body.webhook).toBe("configured");
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ app: "StockPilot AI", symbol: "INFY" });
    expect(JSON.stringify(received[0])).not.toContain(auth);
    const notes = await request(app).get("/api/v1/notifications");
    expect(notes.body.items[0].delivery).toBe("DELIVERED");
  });

  it("records FAILED when the webhook is unreachable and does not crash the check", async () => {
    const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32), ALERT_WEBHOOK_URL: "http://127.0.0.1:1/nowhere" }));
    await request(app).post("/api/v1/alerts").set("X-Admin-Token", "test-admin-token-123456").send({ symbol: "INFY", type: "PRICE_ABOVE", value: 0.01 });
    const check = await request(app).post("/api/v1/alerts/check").set("X-Admin-Token", "test-admin-token-123456");
    expect(check.status).toBe(200);
    const notes = await request(app).get("/api/v1/notifications");
    expect(notes.body.items[0].delivery).toBe("FAILED");
  });

  it("without a webhook, notifications say so instead of claiming delivery", async () => {
    const { app } = createApp(loadEnv({ NODE_ENV: "test", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32) }));
    await request(app).post("/api/v1/alerts").set("X-Admin-Token", "test-admin-token-123456").send({ symbol: "INFY", type: "PRICE_ABOVE", value: 0.01 });
    await request(app).post("/api/v1/alerts/check").set("X-Admin-Token", "test-admin-token-123456");
    const notes = await request(app).get("/api/v1/notifications");
    expect(notes.body.items[0].delivery).toBe("NOT_CONFIGURED");
  });

  it("production refuses a plain-http webhook", () => {
    expect(() => loadEnv({ NODE_ENV: "production", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32), CORS_ORIGINS: "https://a.example", FRONTEND_URL: "https://a.example", ALERT_WEBHOOK_URL: "http://hooks.example/x" })).toThrow(/https/);
  });
});
