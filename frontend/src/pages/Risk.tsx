import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtMoney } from "../lib/format";
import type { RiskView } from "../types";
import { Badge } from "../components/Badge";
import { Card, ErrorBox } from "../components/Card";

export function Risk() {
  const q = useQuery({ queryKey: ["risk"], queryFn: () => api<RiskView>("/risk/limits"), refetchInterval: 15_000 });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <p className="text-sm text-slate-500">Loading…</p>;
  const { limits: l, current: c } = q.data;
  const rows: [string, string][] = [
    ["Capital", fmtMoney(l.capital)],
    ["Max open positions", `${c.openPositions} / ${l.maxOpenPositions}`],
    ["Daily loss limit", `${l.maxDailyLossPct}% of capital (${fmtMoney((l.capital * l.maxDailyLossPct) / 100)})`],
    ["Today's realized P&L", fmtMoney(c.dailyRealizedPnl)],
    ["Max trades per day", String(l.maxTradesPerDay)],
    ["Max single order", `${l.maxOrderValuePct}% of capital`],
    ["Max exposure per stock", `${l.maxExposurePerStockPct}% of capital`],
  ];
  return (
    <Card title="Risk limits (paper account)">
      <p className="mb-3 text-sm">Emergency stop: {c.emergencyStop ? <Badge tone="red">ACTIVE — no new entries</Badge> : <Badge tone="green">Off</Badge>}</p>
      <table className="w-full text-sm">
        <tbody>{rows.map(([k, v]) => <tr key={k} className="border-t border-slate-800"><td className="py-2 text-slate-400">{k}</td><td className="text-right">{v}</td></tr>)}</tbody>
      </table>
      <p className="mt-3 text-xs text-slate-500">These limits are fixed in the backend for now. Changing them from the UI is not implemented.</p>
    </Card>
  );
}
