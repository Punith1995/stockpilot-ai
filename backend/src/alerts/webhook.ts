/** Sends one alert to a configured webhook. The payload contains no secrets. */
export interface WebhookResult { delivered: boolean; status?: number; error?: string }

export async function sendWebhook(url: string, payload: { symbol: string; message: string; at: string }): Promise<WebhookResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "StockPilot-AI-Alerts/1.0" },
      body: JSON.stringify({ app: "StockPilot AI", ...payload }),
      signal: AbortSignal.timeout(5000),
    });
    return { delivered: res.ok, status: res.status, ...(res.ok ? {} : { error: `HTTP ${res.status}` }) };
  } catch (e) {
    return { delivered: false, error: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}
