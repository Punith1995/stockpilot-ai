import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { AppStatus, StrategyInfo } from "../types";
import { Card, ErrorBox } from "../components/Card";
import { fmtMoney } from "../lib/format";

/** Read-only. Settings are defined in the backend; secrets are never shown. */
export function Settings() {
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<AppStatus>("/status") });
  const strat = useQuery({ queryKey: ["strategies"], queryFn: () => api<StrategyInfo>("/strategies") });
  const risk = useQuery({ queryKey: ["risk"], queryFn: () => api<{ limits: Record<string, number> }>("/risk/limits") });
  const cfg = strat.data?.config as Record<string, unknown> | undefined;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Application">
        <ErrorBox error={status.error} />
        {status.data && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-400">Mode</dt><dd>{status.data.mode}</dd>
            <dt className="text-slate-400">Data source</dt><dd>{status.data.dataSource}</dd>
            <dt className="text-slate-400">Live trading</dt><dd>{status.data.liveTrading}</dd>
            <dt className="text-slate-400">Kite configured</dt><dd>{status.data.kite.configured ? "yes" : "no"}</dd>
            <dt className="text-slate-400">Timezone</dt><dd>Asia/Kolkata (NSE session 09:15–15:30)</dd>
          </dl>
        )}
        <p className="mt-3 text-xs text-slate-500">Environment variables are set in Render or backend/.env. Their values are never shown here.</p>
      </Card>
      <Card title="Strategy defaults">
        <ErrorBox error={strat.error} />
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
        <ErrorBox error={risk.error} />
        {risk.data && (
          <table className="w-full text-sm">
            <tbody>
              <tr><td className="py-1.5 text-slate-400">Capital</td><td className="text-right">{fmtMoney(risk.data.limits.capital)}</td></tr>
              <tr><td className="py-1.5 text-slate-400">Max open positions</td><td className="text-right">{risk.data.limits.maxOpenPositions}</td></tr>
              <tr><td className="py-1.5 text-slate-400">Max daily loss %</td><td className="text-right">{risk.data.limits.maxDailyLossPct}</td></tr>
              <tr><td className="py-1.5 text-slate-400">Max trades per day</td><td className="text-right">{risk.data.limits.maxTradesPerDay}</td></tr>
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Not available">
        <p className="text-sm text-slate-400">Changing settings from the UI is not implemented. Persistent settings need a store, which this version does not have.</p>
      </Card>
    </div>
  );
}
