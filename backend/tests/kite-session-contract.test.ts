import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { KiteService } from "../src/broker/kite.js";
import { loadEnv } from "../src/config/env.js";

const env = loadEnv({
  NODE_ENV: "test", ADMIN_TOKEN: "test-admin-token-123456", ENCRYPTION_KEY: "k".repeat(32),
  KITE_API_KEY: "api_key_example", KITE_API_SECRET: "secret_example", KITE_REDIRECT_URL: "https://example.test/api/v1/broker/callback",
});

describe("Kite session exchange matches the documented request", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts api_key, request_token and sha256(api_key + request_token + api_secret) to /session/token", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "success", data: { access_token: "AT123", user_id: "AB1234" } }), { status: 200 }));
    const kite = new KiteService(env);
    await kite.exchange("REQ999");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.kite.trade/session/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Kite-Version"]).toBe("3");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("api_key")).toBe("api_key_example");
    expect(body.get("request_token")).toBe("REQ999");
    expect(body.get("checksum")).toBe(createHash("sha256").update("api_key_example" + "REQ999" + "secret_example").digest("hex"));
    expect(kite.status().connected).toBe(true);
    expect(JSON.stringify(kite.status())).not.toContain("AT123");
  });

  it("does not mark the session connected when Kite rejects the exchange", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "error", message: "Invalid checksum" }), { status: 403 }));
    const kite = new KiteService(env);
    await expect(kite.exchange("REQ999")).rejects.toMatchObject({ status: 502 });
    expect(kite.status().connected).toBe(false);
  });
});
