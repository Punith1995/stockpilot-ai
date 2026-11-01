import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst } from "../lib/format";
import type { BrokerStatus } from "../types";
import { Badge } from "../components/Badge";
import { DiagnosticCard } from "../components/DiagnosticCard";
import { btn, Card, ErrorBox, input, Tile } from "../components/Card";

export function Connection() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const adminToken = useAdmin((s) => s.adminToken);
  const setAdminToken = useAdmin((s) => s.setAdminToken);
  const [requestToken, setRequestToken] = useState("");
  const status = useQuery({ queryKey: ["broker"], queryFn: () => api<BrokerStatus>("/broker/status") });
  const kiteResult = params.get("kite");

  // After Kite redirects back, clear the marker from the URL and refresh the status.
  useEffect(() => {
    if (!kiteResult) return;
    qc.invalidateQueries({ queryKey: ["broker"] });
    const next = new URLSearchParams(params);
    next.delete("kite");
    setParams(next, { replace: true });
  }, [kiteResult]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useMutation({
    mutationFn: () => api<{ url: string }>("/broker/login-url"),
    onSuccess: (d) => { window.location.href = d.url; },
  });
  const exchange = useMutation({
    mutationFn: () => api<BrokerStatus>("/broker/session", { method: "POST", adminToken, body: { requestToken } }),
    onSuccess: () => { setRequestToken(""); qc.invalidateQueries({ queryKey: ["broker"] }); },
  });
  const logout = useMutation({
    mutationFn: () => api<BrokerStatus>("/broker/session", { method: "DELETE", adminToken }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["broker"] }),
  });

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Kite" value={status.data?.connected ? "Session active" : status.data?.configured ? "Not logged in" : "Not configured"} tone={status.data?.connected ? "text-emerald-300" : "text-amber-200"} />
        <Tile label="Mode" value="PAPER" />
        <Tile label="Live trading" value="NOT IMPLEMENTED" tone="text-red-300" />
        <Tile label="Admin token" value={adminToken ? "Entered" : "Missing"} tone={adminToken ? "text-emerald-300" : "text-amber-200"} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <DiagnosticCard />
        <Card title="Admin token">
          <p className="mb-2 text-sm text-slate-400">Needed for backtests, paper actions and logout. Kept in memory only; a page reload clears it.</p>
          <input className={`${input} w-full`} type="password" autoComplete="off" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} placeholder="ADMIN_TOKEN" aria-label="Admin token" />
        </Card>

        <Card title="Zerodha Kite connection">
          {kiteResult === "connected" && (
            <div className="mb-2 rounded border border-emerald-800 bg-emerald-950/40 p-2 text-sm text-emerald-200">
              Kite connected for today. The app now shows live Kite data.
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Link className="underline" to="/overview">Market overview</Link>
                <Link className="underline" to="/chart">Advanced charts</Link>
                <Link className="underline" to="/portfolio">Portfolio</Link>
              </div>
            </div>
          )}
          {kiteResult === "failed" && <p className="mb-2 text-sm text-red-300">Kite login was not completed. Try again.</p>}
          <p className="mb-2 text-sm">
            Status: {status.data?.connected ? <Badge tone="green">Session active</Badge> : status.data?.configured ? <Badge tone="amber">Not logged in</Badge> : <Badge tone="slate">Not configured</Badge>}
          </p>
          <dl className="mb-3 grid grid-cols-[8rem_1fr] gap-1 text-xs">
            <dt className="text-slate-400">API key</dt><dd>{status.data?.apiKeyMasked ?? "Not set"}</dd>
            <dt className="text-slate-400">Session expires</dt><dd>{status.data?.tokenExpiresAt ? fmtIst(new Date(status.data.tokenExpiresAt).getTime()) : "—"} <span className="text-slate-500">(approximate, daily)</span></dd>
          </dl>
          <p className="mb-3 text-xs text-slate-500">{status.data?.note}</p>
          <ErrorBox error={status.error} />
          <button className={`${btn} w-full py-2 text-base`} onClick={() => login.mutate()} disabled={!status.data?.configured || login.isPending}>
            {login.isPending ? "Opening Kite…" : status.data?.connected ? "Log in again to refresh today's session" : "Login with Kite"}
          </button>
          <p className="mt-2 text-xs text-slate-400">
            You will be taken to Zerodha's own login page. Enter your password and OTP there, as usual. Kite then returns you here and the session is connected automatically. Kite sessions expire each day, so this is needed once per day.
          </p>
          <ErrorBox error={login.error} />

          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-slate-400">Manual fallback: paste a request token</summary>
            <div className="mt-2 flex gap-2">
              <input className={`${input} flex-1`} value={requestToken} onChange={(e) => setRequestToken(e.target.value)} placeholder="request_token" aria-label="Request token" />
              <button className={btn} onClick={() => exchange.mutate()} disabled={!adminToken || requestToken.length < 8 || exchange.isPending}>Exchange</button>
            </div>
            <ErrorBox error={exchange.error} />
          </details>

          <div className="mt-4 flex gap-2">
            <button className={btn} onClick={() => logout.mutate()} disabled={!adminToken || !status.data?.connected}>Logout from Kite</button>
          </div>
          <ErrorBox error={logout.error} />
          <p className="mt-3 text-xs text-amber-300">Kite endpoints and the session step are not fully verified against the live service. Read-only use only; no orders are sent.</p>
        </Card>
      </div>
    </div>
  );
}
