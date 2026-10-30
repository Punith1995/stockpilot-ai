import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtIst, fmtNum, REASON_LABELS } from "../lib/format";
import type { DataQuality, Instrument } from "../types";
import { Badge } from "../components/Badge";
import { Card, ErrorBox } from "../components/Card";
import { KiteDataPanel } from "./KiteDataPanel";

export function MarketDataMonitor() {
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const symbols = instruments.data?.items.map((i) => i.symbol) ?? [];
  const quality = useQuery({
    queryKey: ["quality", symbols.join(",")],
    queryFn: () => Promise.all(symbols.map((s) => api<DataQuality>(`/data/quality/${s}`))),
    enabled: symbols.length > 0,
    refetchInterval: 30_000,
  });
  return (
    <div className="grid gap-4">
    <Card title="Market data monitor · SAMPLE feed">
      <ErrorBox error={instruments.error ?? quality.error} />
      <p className="mb-3 text-sm text-slate-400">Shows whether the candle data is complete and valid enough for the strategy. The feed is generated sample data, so there is no live connection to monitor.</p>
      {quality.data && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Received</th><th>Kept</th><th>Dropped</th><th>Duplicates</th><th>Strategy-ready</th><th>Last bar (IST)</th><th>Drop reasons</th></tr></thead>
          <tbody>
            {quality.data.map((d) => (
              <tr key={d.symbol} className="border-t border-slate-800">
                <td className="py-1.5">{d.symbol}</td><td>{fmtNum(d.received, 0)}</td><td>{fmtNum(d.kept, 0)}</td><td>{d.dropped}</td><td>{d.duplicates}</td>
                <td><Badge tone={d.sufficientForStrategy ? "green" : "amber"}>{d.sufficientForStrategy ? "yes" : "no"}</Badge></td>
                <td>{d.lastBar ? fmtIst(new Date(d.lastBar).getTime()) : "—"}</td>
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
