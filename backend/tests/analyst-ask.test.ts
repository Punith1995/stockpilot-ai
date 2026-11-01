import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const TOKEN = "test-admin-token-123456";
const base = { NODE_ENV: "test", ADMIN_TOKEN: TOKEN, ENCRYPTION_KEY: "k".repeat(32) };
const H = { "X-Admin-Token": TOKEN };

describe("analyst free-text questions (rule-based)", () => {
  const { app } = createApp(loadEnv(base));
  it("routes a question to the matching analysis section", async () => {
    const r = await request(app).post("/api/v1/analyst/ask").set(H).send({ symbol: "TCS", question: "What is the RSI right now?" });
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("rule-based");
    expect(r.body.topic).toBe("momentum");
    expect(r.body.answer).toMatch(/RSI/);
  });
  it("answers unknown questions with the list of topics it covers", async () => {
    const r = await request(app).post("/api/v1/analyst/ask").set(H).send({ symbol: "TCS", question: "Who is the prime minister?" });
    expect(r.body.topic).toBe("unknown");
    expect(r.body.answer).toMatch(/trend, momentum/);
  });
  it("requires the admin token and refuses overlong questions", async () => {
    expect((await request(app).post("/api/v1/analyst/ask").send({ symbol: "TCS", question: "trend?" })).status).toBe(401);
    expect((await request(app).post("/api/v1/analyst/ask").set(H).send({ symbol: "TCS", question: "x".repeat(301) })).status).toBe(400);
  });
});

describe("analyst free-text questions (language model path)", () => {
  afterEach(() => vi.restoreAllMocks());
  const { app } = createApp(loadEnv({ ...base, ANTHROPIC_API_KEY: "sk-ant-test-key-1234567890" }));
  it("sends the analysis to the model and returns its answer", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: "The RSI is neutral on these sample bars." }] }), { status: 200 }));
    const r = await request(app).post("/api/v1/analyst/ask").set(H).send({ symbol: "TCS", question: "Is RSI neutral?" });
    expect(r.body.source).toBe("language model");
    expect(r.body.answer).toBe("The RSI is neutral on these sample bars.");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test-key-1234567890");
  });
  it("falls back to rule-based answers when the model call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    const r = await request(app).post("/api/v1/analyst/ask").set(H).send({ symbol: "TCS", question: "What is the trend?" });
    expect(r.body.source).toBe("rule-based");
    expect(r.body.topic).toBe("trend");
  });
});
