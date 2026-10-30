import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import type { BrokerStatus } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, ErrorBox, input } from "../components/Card";

export function Connection() {
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const setAdminToken = useAdmin((s) => s.setAdminToken);
  const [requestToken, setRequestToken] = useState("");
  const status = useQuery({ queryKey: ["broker"], queryFn: () => api<BrokerStatus>("/broker/status") });
  const login = useMutation({ mutationFn: () => api<{ url: string }>("/broker/login-url") });
  const exchange = useMutation({
    mutationFn: () => api<BrokerStatus>("/broker/session", { method: "POST", adminToken, body: { requestToken } }),
    onSuccess: () => { setRequestToken(""); qc.invalidateQueries({ queryKey: ["broker"] }); },
  });
  const logout = useMutation({
    mutationFn: () => api<BrokerStatus>("/broker/session", { method: "DELETE", adminToken }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["broker"] }),
  });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Admin token">
        <p className="mb-2 text-sm text-slate-400">Needed for backtests, paper actions and the Kite session. Kept in memory only; a page reload clears it.</p>
        <input className={`${input} w-full`} type="password" autoComplete="off" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} placeholder="ADMIN_TOKEN" aria-label="Admin token" />
      </Card>

      <Card title="Zerodha Kite connection">
        <p className="mb-2 text-sm">
          Status: {status.data?.connected ? <Badge tone="green">Session active</Badge> : status.data?.configured ? <Badge tone="amber">Not logged in</Badge> : <Badge tone="slate">Not configured</Badge>}
        </p>
        <p className="mb-3 text-xs text-slate-500">{status.data?.note}</p>
        <ErrorBox error={status.error} />
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => login.mutate()} disabled={!status.data?.configured}>Get login URL</button>
          {login.data && <a className="text-sm text-sky-400 underline" href={login.data.url} target="_blank" rel="noreferrer">Open Kite login</a>}
        </div>
        <ErrorBox error={login.error} />
        <p className="mt-3 text-xs text-slate-500">After logging in, paste the request_token from the redirect URL below.</p>
        <div className="mt-2 flex gap-2">
          <input className={`${input} flex-1`} value={requestToken} onChange={(e) => setRequestToken(e.target.value)} placeholder="request_token" aria-label="Request token" />
          <button className={btn} onClick={() => exchange.mutate()} disabled={!adminToken || requestToken.length < 8 || exchange.isPending}>Exchange</button>
          <button className={btn} onClick={() => logout.mutate()} disabled={!adminToken}>Logout</button>
        </div>
        <ErrorBox error={exchange.error ?? logout.error} />
        <p className="mt-3 text-xs text-amber-300">Kite endpoints and checksum are unverified against the live service. Read-only use only; no orders are sent.</p>
      </Card>
    </div>
  );
}
