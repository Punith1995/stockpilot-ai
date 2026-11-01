import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { LiveGates, RiskView } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, Empty, ErrorBox, input, Tile } from "../components/Card";

const TABS = ["Open", "Active", "Completed", "Rejected"] as const;
type Tab = (typeof TABS)[number];

/** Live trading is not implemented. The order panel is shown for layout only and cannot submit. */
export function LiveTrading() {
  const [tab, setTab] = useState<Tab>("Open");
  const live = useQuery({ queryKey: ["live"], queryFn: () => api<LiveGates>("/live/status"), refetchInterval: 30_000 });
  const risk = useQuery({ queryKey: ["risk"], queryFn: () => api<RiskView>("/risk/limits"), refetchInterval: 15_000 });
  const emergency = risk.data?.current.emergencyStop ?? false;

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
        Live trading is disabled and not implemented in this version. No real orders can be placed from this app. Use Paper trading in the Portfolio page to practise.
      </div>
      <ErrorBox error={live.error ?? risk.error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Live trading" value={<Badge tone="red">Not implemented</Badge>} />
        <Tile label="Broker" value={<Link className="text-sky-400 underline" to="/connection">Manage on Connection page</Link>} />
        <Tile label="Market data" value="Sample data" />
        <Tile label="Available funds" value="Unavailable" tone="text-slate-400" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="Orders">
          <div role="tablist" className="mb-3 flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>{t}</button>
            ))}
          </div>
          <Empty>No {tab.toLowerCase()} live orders. Live orders are not available in this version.</Empty>

          <div className="mt-4 grid gap-3 border-t border-slate-800 pt-4 text-sm md:grid-cols-3">
            <label>Symbol<select className={`${input} mt-1 w-full`} disabled><option>Select stock</option></select></label>
            <label>Quantity<input className={`${input} mt-1 w-full`} type="number" disabled placeholder="0" /></label>
            <label>Order type<select className={`${input} mt-1 w-full`} disabled><option>Limit</option><option>Market</option><option>Stop</option></select></label>
            <label>Price<input className={`${input} mt-1 w-full`} type="number" disabled /></label>
            <label>Stop-loss<input className={`${input} mt-1 w-full`} type="number" disabled /></label>
            <label>Target<input className={`${input} mt-1 w-full`} type="number" disabled /></label>
          </div>
          <div className="mt-3 flex gap-2">
            <button className={btn} disabled>Buy (not available)</button>
            <button className={`${btn} bg-red-700 hover:bg-red-600`} disabled>Sell (not available)</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Order entry is shown for layout only. It is disabled until live trading is implemented.</p>
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Safety panel">
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
              <dt className="text-slate-400">Emergency stop</dt><dd>{emergency ? <Badge tone="red">ON</Badge> : <Badge tone="green">Off</Badge>}</dd>
              <dt className="text-slate-400">Max open positions</dt><dd>{risk.data?.limits.maxOpenPositions ?? "—"}</dd>
              <dt className="text-slate-400">Max order value</dt><dd>{risk.data ? `${risk.data.limits.maxOrderValuePct}% of capital` : "—"}</dd>
              <dt className="text-slate-400">Max exposure per stock</dt><dd>{risk.data ? `${risk.data.limits.maxExposurePerStockPct}%` : "—"}</dd>
              <dt className="text-slate-400">Max daily loss</dt><dd>{risk.data ? `${risk.data.limits.maxDailyLossPct}%` : "—"}</dd>
              <dt className="text-slate-400">Max trades per day</dt><dd>{risk.data?.limits.maxTradesPerDay ?? "—"}</dd>
            </dl>
            <p className="mt-3 text-xs text-slate-500">Limits come from the backend risk configuration.</p>
          </Card>

          <Card title="Live gates">
            {live.data && (
              <ul className="space-y-2 text-sm">
                {live.data.gates.map((g) => (
                  <li key={g.id} className="flex items-start justify-between gap-3 rounded border border-slate-800 p-2">
                    <span>{g.label}{g.detail && <span className="block text-xs text-slate-500">{g.detail}</span>}</span>
                    <Badge tone={g.ok ? "green" : "red"}>{g.ok ? "pass" : "fail"}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500">{live.data?.note}</p>
            <button className={`${btn} mt-3 w-full`} disabled>Enable live trading (not available)</button>
          </Card>
        </div>
      </div>
    </div>
  );
}
