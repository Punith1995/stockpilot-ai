import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtMoney, fmtNum, fmtPct } from "../lib/format";
import type { MarketOverviewItem } from "../types";
import { Card, ErrorBox } from "../components/Card";

export function MarketOverview() {
  const q = useQuery({ queryKey: ["overview"], queryFn: () => api<{ items: MarketOverviewItem[]; note: string }>("/market/overview"), refetchInterval: 30_000 });
  return (
    <Card title="Market overview · SAMPLE">
      <ErrorBox error={q.error} />
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {q.data && (
        <>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Name</th><th>Last</th><th>Change</th><th>Volume (today)</th></tr></thead>
            <tbody>
              {q.data.items.map((i) => (
                <tr key={i.symbol} className="border-t border-slate-800">
                  <td className="py-1.5 font-medium">{i.symbol}</td><td className="text-slate-400">{i.name}</td><td>{fmtMoney(i.last)}</td>
                  <td className={i.changePct >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtPct(i.changePct)}</td><td>{fmtNum(i.volume, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">{q.data.note}</p>
        </>
      )}
    </Card>
  );
}
