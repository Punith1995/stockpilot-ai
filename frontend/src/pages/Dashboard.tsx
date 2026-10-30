import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtMoney } from "../lib/format";
import { usePushStatus } from "../lib/useLiveStatus";
import type { AppStatus, PaperSnapshot } from "../types";
import { Badge } from "../components/Badge";
import { Card, ErrorBox } from "../components/Card";

export function Dashboard() {
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<AppStatus>("/status"), refetchInterval: 15_000 });
  const paper = useQuery({ queryKey: ["paper"], queryFn: () => api<PaperSnapshot>("/paper"), refetchInterval: 15_000 });
  const push = usePushStatus();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="System">
        <ErrorBox error={status.error} />
        {status.data && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-slate-400">Mode</dt><dd><Badge tone="amber">{status.data.mode}</Badge></dd>
            <dt className="text-slate-400">Data source</dt><dd><Badge tone="slate">{status.data.dataSource}</Badge></dd>
            <dt className="text-slate-400">Live trading</dt><dd><Badge tone="red">{status.data.liveTrading}</Badge></dd>
            <dt className="text-slate-400">Market (NSE)</dt><dd>{status.data.marketOpen ? "Open" : "Closed"}</dd>
            <dt className="text-slate-400">Kite session</dt><dd>{status.data.kite.connected ? "Connected" : status.data.kite.configured ? "Not logged in" : "Not configured"}</dd>
            <dt className="text-slate-400">Server time</dt><dd>{new Date(status.data.serverTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</dd>
          </dl>
        )}
        {!status.data && !status.error && <p className="text-sm text-slate-500">Loading…</p>}
      </Card>

      <Card title="Paper account">
        <ErrorBox error={paper.error} />
        {paper.data && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-slate-400">Starting capital</dt><dd>{fmtMoney(paper.data.startCapital)}</dd>
            <dt className="text-slate-400">Cash</dt><dd>{fmtMoney(paper.data.cash)}</dd>
            <dt className="text-slate-400">Realized P&amp;L</dt><dd>{fmtMoney(paper.data.realizedPnl)}</dd>
            <dt className="text-slate-400">Open positions</dt><dd>{paper.data.positions.length}</dd>
            <dt className="text-slate-400">Emergency stop</dt><dd>{paper.data.emergencyStop ? <Badge tone="red">ON</Badge> : "Off"}</dd>
          </dl>
        )}
      </Card>

      <Card title="Push channel">
        <p className="text-sm text-slate-300">
          {push.connected ? "Connected to the backend WebSocket." : "Not connected. Retrying with backoff."}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          This shows the backend push channel only. It does not mean market data is live.
          {push.lastAt && ` Last update ${new Date(push.lastAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST.`}
        </p>
      </Card>

      <Card title="What works today">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li>Strategy analysis and scanner on SAMPLE data</li>
          <li>Single-symbol backtest with stated metrics</li>
          <li>Paper trading with duplicate-signal protection</li>
          <li>Kite login flow (unverified against live Kite)</li>
          <li className="text-slate-500">Not implemented: live orders, real NSE data feed, multi-day walk-forward</li>
        </ul>
      </Card>
    </div>
  );
}
