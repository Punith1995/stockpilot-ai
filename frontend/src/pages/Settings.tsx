import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fmtIst, fmtMoney } from "../lib/format";
import { getDefaultTimeframe, setDefaultTimeframe, TIMEFRAMES } from "../lib/prefs";
import { usePushStatus } from "../lib/useLiveStatus";
import type { AppStatus, BrokerStatus, RecentError, StrategyInfo } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, Empty, ErrorBox } from "../components/Card";

export function Settings() {
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<AppStatus>("/status"), refetchInterval: 30_000 });
  const broker = useQuery({ queryKey: ["broker"], queryFn: () => api<BrokerStatus>("/broker/status") });
  const strat = useQuery({ queryKey: ["strategies"], queryFn: () => api<StrategyInfo>("/strategies") });
  const risk = useQuery({ queryKey: ["risk"], queryFn: () => api<{ limits: Record<string, number> }>("/risk/limits") });
  const errors = useQuery({ queryKey: ["errors-recent"], queryFn: () => api<{ items: RecentError[] }>("/errors/recent"), refetchInterval: 30_000 });
  const push = usePushStatus();
  const [tf, setTf] = useState(getDefaultTimeframe);
  const cfg = strat.data?.config as Record<string, unknown> | undefined;
  const kiteBadge = broker.data?.connected ? <Badge tone="green">Connected</Badge> : broker.data?.configured ? <Badge tone="amber">Not logged in</Badge> : <Badge tone="red">Not connected</Badge>;
  const backendUp = !status.isError && !!status.data;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ErrorBox error={status.error ?? broker.error ?? strat.error ?? risk.error} />

      <Card title="System status" actions={<span className="text-xs text-slate-500">Last update {status.dataUpdatedAt ? fmtIst(status.dataUpdatedAt) : "—"}</span>}>
        <dl className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
          <dt className="text-slate-400">Backend</dt><dd>{backendUp ? <Badge tone="green">Reachable</Badge> : <Badge tone="red">Not reachable</Badge>}{status.data?.serverStartedAt && <span className="ml-2 text-xs text-slate-500">started {fmtIst(new Date(status.data.serverStartedAt).getTime())}</span>}</dd>
          <dt className="text-slate-400">Live push (WebSocket)</dt><dd>{push.connected ? <Badge tone="green">Connected</Badge> : <Badge tone="amber">Reconnecting</Badge>}{push.lastAt && <span className="ml-2 text-xs text-slate-500">last push {fmtIst(new Date(push.lastAt).getTime())}</span>}</dd>
          <dt className="text-slate-400">Frontend</dt><dd><Badge tone="green">Running</Badge></dd>
          <dt className="text-slate-400">Market data</dt><dd>{status.data?.dataSource ?? "—"} · market {status.data?.marketOpen ? "open" : "closed"}</dd>
        </dl>
        <p className="mt-2 text-xs text-slate-500">Reconnects automatically with a back-off of up to 30 seconds.</p>
      </Card>

      <Card title="Zerodha Kite connection" actions={kiteBadge}>
        <dl className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
          <dt className="text-slate-400">Configured</dt><dd>{broker.data?.configured ? "Yes" : "No (set KITE_API_KEY, KITE_API_SECRET and KITE_REDIRECT_URL on the server)"}</dd>
          <dt className="text-slate-400">API key</dt><dd>{broker.data?.apiKeyMasked ?? "—"}</dd>
          <dt className="text-slate-400">Session</dt><dd>{broker.data?.connected ? `Active since ${broker.data.tokenSetAt ? fmtIst(new Date(broker.data.tokenSetAt).getTime()) : "—"}` : "No active session"}</dd>
          <dt className="text-slate-400">Expires about</dt><dd>{broker.data?.tokenExpiresAt ? fmtIst(new Date(broker.data.tokenExpiresAt).getTime()) : "—"}</dd>
        </dl>
        <p className="mt-3 text-xs text-slate-500">Kite endpoints are unverified against the live service. Session tokens reset on restart.</p>
        <div className="mt-3"><Link to="/connection" className={btn}>Open connection page</Link></div>
      </Card>

      <Card title="Display defaults · this browser">
        <label className="grid gap-1 text-sm">Default timeframe for Advanced Charts
          <select className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5" value={tf} onChange={(e) => { setTf(e.target.value); setDefaultTimeframe(e.target.value); }}>
            {TIMEFRAMES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <p className="mt-2 text-xs text-slate-500">Saved in this browser only. Opening Advanced Charts uses it.</p>
      </Card>

      <Card title="Notifications">
        <dl className="grid grid-cols-[10rem_1fr] gap-2 text-sm">
          <dt className="text-slate-400">In-app alerts</dt><dd><Badge tone="green">On</Badge> shown on the Alerts page after Check now</dd>
          <dt className="text-slate-400">Webhook delivery</dt><dd>{status.data?.alertWebhookConfigured ? <Badge tone="green">Configured on server</Badge> : <Badge tone="slate">Not configured</Badge>}</dd>
          <dt className="text-slate-400">Email / SMS / push</dt><dd className="text-slate-400">Not available in this version</dd>
        </dl>
      </Card>

      <Card title="Application">
        <dl className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
          <dt className="text-slate-400">Mode</dt><dd>{status.data?.mode ?? "—"}</dd>
          <dt className="text-slate-400">Data source</dt><dd>{status.data?.dataSource ?? "—"} (switches to Kite when connected)</dd>
          <dt className="text-slate-400">Live trading</dt><dd className="text-red-300">{status.data?.liveTrading ?? "—"}</dd>
          <dt className="text-slate-400">Timezone</dt><dd>Asia/Kolkata · NSE 09:15–15:30 IST</dd>
          <dt className="text-slate-400">Language</dt><dd>English</dd>
          <dt className="text-slate-400">Theme</dt><dd>Dark</dd>
        </dl>
        <p className="mt-3 text-xs text-slate-500">Settings are fixed in this version. Environment values are never shown here.</p>
      </Card>

      <Card title="Recent server errors">
        <ErrorBox error={errors.error} />
        {errors.data && !errors.data.items.length && <Empty>No server errors since the last restart.</Empty>}
        {errors.data && errors.data.items.length > 0 && (
          <table className="w-full text-left text-xs">
            <thead className="uppercase text-slate-500"><tr><th className="py-1">Time</th><th>Code</th><th>Path</th><th>Message</th></tr></thead>
            <tbody>{errors.data.items.slice(0, 10).map((e, i) => (
              <tr key={i} className="border-t border-slate-800"><td className="py-1 whitespace-nowrap">{fmtIst(new Date(e.at).getTime())}</td><td>{e.code}</td><td>{e.path}</td><td className="text-slate-400">{e.message}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <Card title="Strategy defaults">
        {cfg && (
          <table className="w-full text-sm">
            <tbody>
              {["fastEma", "slowEma", "trendEma", "rsiMin", "rsiMax", "minRelativeVolume", "minAdx", "atrMultiple", "targetR", "maxHoldBars", "riskPerTradePct", "maxPositionPct"].map((k) => (
                <tr key={k} className="border-t border-slate-800"><td className="py-1.5 text-slate-400">{k}</td><td className="text-right">{String(cfg[k])}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Risk limits">
        {risk.data && (
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-t border-slate-800"><td className="py-1.5 text-slate-400">Capital</td><td className="text-right">{fmtMoney(risk.data.limits.capital)}</td></tr>
              <tr className="border-t border-slate-800"><td className="py-1.5 text-slate-400">Max open positions</td><td className="text-right">{risk.data.limits.maxOpenPositions}</td></tr>
              <tr className="border-t border-slate-800"><td className="py-1.5 text-slate-400">Max daily loss %</td><td className="text-right">{risk.data.limits.maxDailyLossPct}</td></tr>
              <tr className="border-t border-slate-800"><td className="py-1.5 text-slate-400">Max trades per day</td><td className="text-right">{risk.data.limits.maxTradesPerDay}</td></tr>
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
