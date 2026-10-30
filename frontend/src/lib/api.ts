/** Thin fetch wrapper. Errors come back as ApiError with the backend's code and message. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; adminToken?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.adminToken) headers["X-Admin-Token"] = opts.adminToken;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Cannot reach the backend. It may be asleep (free plan) or offline.");
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & T;
  if (!res.ok) throw new ApiError(res.status, json.error?.code ?? "HTTP_" + res.status, json.error?.message ?? `Request failed (${res.status})`);
  return json as T;
}

export const wsUrl = (): string => {
  if (BASE) return BASE.replace(/^http/, "ws") + "/ws";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
};
