import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtMoney, fmtPct } from "../lib/format";
import type { PaperSnapshot } from "../types";
import { Card, Empty, ErrorBox } from "../components/Card";

export function Portfolio() {
  const q = useQuery({ queryKey: ["paper"], queryFn: () => api<PaperSnapshot>("/paper"), refetchInterval: 10_000 });
  const p = q.data;
  const invested = p?.positions.reduce((s, x) => s + x.qty * x.entry, 0) ?? 0;
  const equity = p ? p.cash + invested : 0;
  return (
    <div className="grid gap-4">
      <Card title="Portfolio · paper account">
        <ErrorBox error={q.error} />
        {p && (
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><dt className="text-slate-400">Equity (at cost)</dt><dd>{fmtMoney(equity)}</dd></div>
            <div><dt className="text-slate-400">Cash</dt><dd>{fmtMoney(p.cash)}</dd></div>
            <div><dt className="text-slate-400">Invested at cost</dt><dd>{fmtMoney(invested)}</dd></div>
            <div><dt className="text-slate-400">Return on start</dt><dd>{fmtPct(((equity - p.startCapital) / p.startCapital) * 100)}</dd></div>
          </dl>
        )}
        <p className="mt-2 text-xs text-slate-500">Positions are valued at entry price; no mark-to-market feed exists yet.</p>
      </Card>
      <Card title="Positions">
        {!p?.positions.length ? <Empty>No open positions.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Qty</th><th>Avg entry</th><th>Cost</th><th>Stop</th><th>Target</th></tr></thead>
            <tbody>
              {p.positions.map((x) => (
                <tr key={x.symbol} className="border-t border-slate-800"><td className="py-1.5">{x.symbol}</td><td>{x.qty}</td><td>{fmtMoney(x.entry)}</td><td>{fmtMoney(x.qty * x.entry)}</td><td>{fmtMoney(x.stop)}</td><td>{fmtMoney(x.target)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
