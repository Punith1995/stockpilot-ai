import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtIst, fmtNum, REASON_LABELS } from "../lib/format";
import type { DataQuality, Instrument } from "../types";
import { Badge } from "../components/Badge";
import { Card, ErrorBox } from "../components/Card";
import { KiteDataPanel } from "./KiteDataPanel";
import { usePushStatus } from "../lib/useLiveStatus";
import type { AppStatus } from "../types";
import { useDataSource } from "../lib/source";

const STALE_MS = 5 * 60_000;

/** Freshness of the last bar: sample data is never live, so it is labelled as such instead of "stale". */
function freshness(lastBar: string | null, dataSource: string, marketOpen: boolean): { label: string; tone: "green" | "amber" | "slate" | "red" } {
  if (dataSource !== "KITE") return { label: "Sample data · not live", tone: "slate" };
  if (!lastBar) return { label: "No bars", tone: "red" };
  if (!marketOpen) return { label: "Market closed", tone: "slate" };
  return Date.now() - new Date(lastBar).getTime() > STALE_MS ? { label: "Stale", tone: "amber" } : { label: "Fresh", tone: "green" };
}

export function MarketDataMonitor() {
  const src = useDataSource();
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const symbols = instruments.data?.items.map((i) => i.symbol) ?? [];
  const quality = useQuery({
    queryKey: ["quality", symbols.join(",")],
    queryFn: () => Promise.all(symbols.map((s) => api<DataQuality>(`/data/quality/${s}`))),
    enabled: symbols.length > 0,
    refetchInterval: 30_000,
  });
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<AppStatus>("/status"), refetchInterval: 30_000 });
  const push = usePushStatus();
  const ds = status.data?.dataSource ?? "SAMPLE";
  const open = status.data?.marketOpen ?? false;
  return (
    <div className="grid gap-4">
    <Card title="Feed status">
      <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <div><dt className="text-slate-400">Market data</dt><dd>{ds === "KITE" ? "Kite live" : "SAMPLE (generated)"}</dd></div>
        <div><dt className="text-slate-400">Market</dt><dd>{open ? "Open" : "Closed"}</dd></div>
        <div><dt className="text-slate-400">Live push (WebSocket)</dt><dd>{push.connected ? <Badge tone="green">Connected</Badge> : <Badge tone="amber">Reconnecting</Badge>}</dd></div>
        <div><dt className="text-slate-400">Last push</dt><dd>{push.lastAt ? fmtIst(new Date(push.lastAt).getTime()) : "—"}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-slate-500">Stale means the last bar is more than 5 minutes old while the market is open on a Kite feed. Sample data is never marked stale.</p>
    </Card>
    <Card title={`Market data monitor · ${src.word} feed`}>
      <ErrorBox error={instruments.error ?? quality.error} />
      <p className="mb-3 text-sm text-slate-400">Shows whether the candle data is complete and valid enough for the strategy. The feed is generated sample data, so there is no live connection to monitor.</p>
      {quality.data && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Received</th><th>Kept</th><th>Dropped</th><th>Duplicates</th><th>Strategy-ready</th><th>Last bar (IST)</th><th>Freshness</th><th>Drop reasons</th></tr></thead>
          <tbody>
            {quality.data.map((d) => (
              <tr key={d.symbol} className="border-t border-slate-800">
                <td className="py-1.5">{d.symbol}</td><td>{fmtNum(d.received, 0)}</td><td>{fmtNum(d.kept, 0)}</td><td>{d.dropped}</td><td>{d.duplicates}</td>
                <td><Badge tone={d.sufficientForStrategy ? "green" : "amber"}>{d.sufficientForStrategy ? "yes" : "no"}</Badge></td>
                <td>{d.lastBar ? fmtIst(new Date(d.lastBar).getTime()) : "—"}</td>
                <td><Badge tone={freshness(d.lastBar, ds, open).tone}>{freshness(d.lastBar, ds, open).label}</Badge></td>
                <td className="text-slate-400">{Object.entries(d.droppedByReason).map(([r, n]) => `${REASON_LABELS[r] ?? r}: ${n}`).join("; ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
    <KiteDataPanel />
    </div>
  );
}
