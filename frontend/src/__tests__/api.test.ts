import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("surfaces the backend error code and message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Admin token required" } }), { status: 401 })));
    await expect(api("/backtests", { body: {} })).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED", message: "Admin token required" });
  });
  it("sends the admin token only as a header", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await api("/paper", { adminToken: "secret-token-123456" });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Admin-Token"]).toBe("secret-token-123456");
    expect(String(spy.mock.calls[0][0])).not.toContain("secret-token");
  });
  it("explains a network failure in plain words", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
    const err = await api("/status").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("NETWORK");
  });
});
