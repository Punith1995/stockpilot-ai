/**
 * Zerodha Kite Connect session handling. READ-ONLY use: login, session exchange, status, logout.
 * No order placement exists in this codebase.
 *
 * UNVERIFIED: the endpoint URLs and checksum rule below follow Kite Connect's public docs as
 * understood when this was written. The sandbox could not reach kite.trade docs, so they have
 * NOT been checked against the live service. Confirm them before relying on login.
 */
import { createHash } from "node:crypto";
import type { Env } from "../config/env.js";
import { decryptSecret, encryptSecret } from "../utils/crypto.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const LOGIN_BASE = "https://kite.zerodha.com/connect/login";
const SESSION_URL = "https://api.kite.trade/session/token";

export class KiteService {
  private encryptedToken: string | null = null;
  private tokenSetAt: number | null = null;

  constructor(private env: Env) {}

  get configured(): boolean { return this.env.kiteConfigured; }

  loginUrl(): string {
    if (!this.env.kiteConfigured) throw new AppError(503, "BROKER_NOT_CONFIGURED", "KITE_API_KEY, KITE_API_SECRET and KITE_REDIRECT_URL must be set");
    return `${LOGIN_BASE}?v=3&api_key=${encodeURIComponent(this.env.KITE_API_KEY!)}`;
  }

  /** Exchanges the request_token from the redirect for an access token. Token is kept encrypted in memory only. */
  async exchange(requestToken: string): Promise<void> {
    if (!this.env.kiteConfigured) throw new AppError(503, "BROKER_NOT_CONFIGURED", "Kite is not configured");
    const apiKey = this.env.KITE_API_KEY!;
    const checksum = createHash("sha256").update(apiKey + requestToken + this.env.KITE_API_SECRET!).digest("hex");
    const body = new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum });
    let res: Response;
    try {
      res = await fetch(SESSION_URL, { method: "POST", headers: { "X-Kite-Version": "3", "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new AppError(502, "BROKER_UNREACHABLE", "Could not reach Kite to exchange the session");
    }
    const json = (await res.json().catch(() => ({}))) as { data?: { access_token?: string } };
    if (!res.ok || !json.data?.access_token) {
      logger.warn({ status: res.status }, "kite session exchange failed");
      throw new AppError(502, "BROKER_SESSION_FAILED", "Kite rejected the session exchange");
    }
    this.encryptedToken = encryptSecret(json.data.access_token);
    this.tokenSetAt = Date.now();
  }

  accessToken(): string | null {
    return this.encryptedToken ? decryptSecret(this.encryptedToken) : null;
  }

  /** Call when Kite answers 403 for a data request: the session is no longer valid. */
  markExpired(): void { this.encryptedToken = null; this.tokenSetAt = null; }

  logout(): void { this.markExpired(); }

  status() {
    return {
      configured: this.configured,
      connected: this.encryptedToken !== null,
      tokenSetAt: this.tokenSetAt ? new Date(this.tokenSetAt).toISOString() : null,
      note: "Kite access tokens are session-bound and are not stored on disk. Restarting the server clears them.",
    };
  }
}
