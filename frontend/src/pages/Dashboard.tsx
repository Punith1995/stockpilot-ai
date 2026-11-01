import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtMoney, fmtNum, fmtPct } from "../lib/format";
import type { AppStatus, PaperSnapshot, QuoteRow, QuotesResponse } from "../types";
import { Card, ErrorBox, Empty, Tile } from "../components/Card";
import type { BrokerStatus } from "../types";
import { Link } from "react-router-dom";

interface ScanRow { symbol: string; signal: "BUY" | "WAIT"; passedChecks: number; totalChecks: number }
interface AlertRule { id: string; symbol: string; type: string; value?: number }

const tone = (n: number) => (n >= 0 ? "text-emerald-400" : "text-red-400");

function IndexCard({ q }: { q: QuoteRow }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-[#0d1528] p-3">
      <div className="text-xs text-slate-400">{q.symbol}</div>
      <div className="mt-1 text-xl font-semibold">{fmtNum(q.last)}</div>
      <div className={`text-sm ${tone(q.changePct)}`}>{fmtNum(q.change)} ({fmtPct(q.changePct)})</div>
    </div>
  );
}

function MoverList({ rows, up }: { rows: QuoteRow[]; up: boolean }) {
  if (!rows.length) return <Empty>No data.</Empty>;
  return (
    <ul className="divide-y divide-slate-800 text-sm">
      {rows.map((r) => (
        <li key={r.symbol} className="flex justify-between py-1.5">
          <span>{r.symbol}</span>
          <span className={up ? "text-emerald-400" : "text-red-400"}>{fmtPct(r.changePct)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Dashboard() {
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: () => api<QuotesResponse>("/market/quotes"), refetchInterval: 15_000 });
  const scan = useQuery({ queryKey: ["dash-scan"], queryFn: () => api<{ results: ScanRow[] }>("/scanner/run", { method: "POST", body: {} }), refetchInterval: 60_000 });
  const paper = useQuery({ queryKey: ["paper"], queryFn: () => api<PaperSnapshot>("/paper"), refetchInterval: 15_000 });
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<AppStatus>("/status"), refetchInterval: 30_000 });
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: () => api<{ items: AlertRule[] }>("/alerts") });
  const broker = useQuery({ queryKey: ["broker"], queryFn: () => api<BrokerStatus>("/broker/status") });
  const active = useQuery({ queryKey: ["strategy-active"], queryFn: () => api<{ overrides: { groups?: unknown[]; conditions?: Record<string, unknown> } }>("/strategies/active") });
  const lists = useQuery({ queryKey: ["watchlists"], queryFn: () => api<{ items: { name: string; symbols: string[] }[] }>("/watchlists") });
  const pd = paper.data;
  const trades = pd?.trades ?? [];
  const istDay = (ms: number) => Math.floor((ms + 19_800_000) / 86_400_000);
  const today = istDay(Date.now());
  const todayPnl = trades.filter((t) => istDay(t.exitTime) === today).reduce((sum, t) => sum + t.netPnl, 0);
  const wins = trades.filter((t) => t.netPnl > 0).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : null;
  const invested = (pd?.positions ?? []).reduce((sum, p) => sum + p.qty * p.entry, 0);
  const portfolioValue = pd ? pd.cash + invested : null;
  const recentTrades = [...trades].reverse().slice(0, 5);
  const q = quotes.data;
  const b = q?.breadth ?? { advancing: 0, declining: 0, unchanged: 0 };
  const total = Math.max(1, b.advancing + b.declining + b.unchanged);
  const activeScans = [...(scan.data?.results ?? [])].sort((a, b2) => Number(b2.signal === "BUY") - Number(a.signal === "BUY")).slice(0, 5);

  return (
    <div className="grid gap-4">
      <ErrorBox error={quotes.error ?? scan.error ?? paper.error} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Portfolio value (paper, at entry prices)" value={portfolioValue == null ? "—" : fmtMoney(portfolioValue)} />
        <Tile label="Today's P&L (paper)" value={pd ? fmtMoney(todayPnl) : "—"} tone={todayPnl >= 0 ? "text-emerald-300" : "text-red-300"} />
        <Tile label="Win rate (paper trades)" value={winRate == null ? "No trades" : fmtPct(winRate)} />
        <Tile label="Active positions" value={pd ? `${pd.positions.length} / 5` : "—"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-4">
        <div className="grid gap-4 xl:col-span-3 xl:grid-cols-3">
          {(q?.indices ?? []).slice(0, 3).map((i) => <IndexCard key={i.symbol} q={i} />)}
        </div>
        <Card title="Market status">
          <div className={`text-2xl font-semibold ${status.data?.marketOpen ? "text-emerald-400" : "text-slate-300"}`}>{status.data ? (status.data.marketOpen ? "Open" : "Closed") : "—"}</div>
          <div className="mt-1 text-xs text-slate-400">NSE session 09:15–15:30 IST, Mon–Fri</div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Market breadth">
          <div className="mb-2 flex h-2 overflow-hidden rounded bg-slate-800">
            <div className="bg-emerald-500" style={{ width: `${(b.advancing / total) * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${(b.declining / total) * 100}%` }} />
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-emerald-400">Advancing {b.advancing}</span>
            <span className="text-red-400">Declining {b.declining}</span>
            <span className="text-slate-400">Unchanged {b.unchanged}</span>
          </div>
        </Card>
        <Card title="Top gainers"><MoverList rows={q?.topGainers ?? []} up /></Card>
        <Card title="Top losers"><MoverList rows={q?.topLosers ?? []} up={false} /></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Active scanner results" className="xl:col-span-2" actions={<Link to="/scanner" className="text-sm text-sky-400 hover:underline">Open scanner</Link>}>
          {!activeScans.length ? <Empty>No scanner results yet.</Empty> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Signal</th><th>Score</th></tr></thead>
              <tbody>
                {activeScans.map((r) => (
                  <tr key={r.symbol} className="border-t border-slate-800">
                    <td className="py-1.5">{r.symbol}</td>
                    <td className={r.signal === "BUY" ? "text-emerald-400" : "text-slate-400"}>{r.signal}</td>
                    <td>{Math.round((r.passedChecks / Math.max(1, r.totalChecks)) * 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <div className="grid gap-4">
          <Card title="Paper performance">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-400">Capital</dt><dd className="text-right">{fmtMoney(paper.data?.startCapital ?? null)}</dd>
              <dt className="text-slate-400">Realized P&amp;L</dt><dd className={`text-right ${tone(paper.data?.realizedPnl ?? 0)}`}>{fmtMoney(paper.data?.realizedPnl ?? null)}</dd>
            </dl>
          </Card>
          <Card title="Broker connection">
            <div className={`text-sm font-semibold ${broker.data?.connected ? "text-emerald-300" : "text-amber-200"}`}>{broker.data?.connected ? "Kite session active" : broker.data?.configured ? "Not logged in" : "Not configured"}</div>
            <p className="mt-1 text-xs text-slate-400">{broker.data?.connected ? "Read-only session. Orders are not sent." : "Use Login with Kite in the top bar, or the Connection page."}</p>
          </Card>
          <Card title="Active strategy" actions={<Link to="/strategy" className="text-sm text-sky-400 hover:underline">Edit</Link>}>
            <div className="text-sm font-semibold">EMA Momentum Pro</div>
            <p className="mt-1 text-xs text-slate-400">
              {active.data ? (Object.keys(active.data.overrides).length
                ? `Custom rules: ${Object.keys(active.data.overrides.conditions ?? {}).length} condition settings, ${active.data.overrides.groups?.length ?? 0} AND/OR group(s).`
                : "Built-in default rules.") : "Loading…"}
            </p>
          </Card>
          <Card title="Watchlists" actions={<Link to="/watchlists" className="text-sm text-sky-400 hover:underline">Open</Link>}>
            {!lists.data?.items.length ? <Empty>No watchlists yet.</Empty> : (
              <ul className="divide-y divide-slate-800 text-sm">
                {lists.data.items.slice(0, 3).map((w) => (
                  <li key={w.name} className="flex justify-between py-1.5">
                    <span>{w.name}</span>
                    <span className="text-slate-400">{w.symbols.length ? w.symbols.join(", ") : "empty"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent paper trades">
            {!recentTrades.length ? <Empty>No paper trades yet.</Empty> : (
              <ul className="divide-y divide-slate-800 text-sm">
                {recentTrades.map((t, i) => (
                  <li key={`${t.symbol}-${t.exitTime}-${i}`} className="flex justify-between py-1.5">
                    <span>{t.symbol}</span>
                    <span className={t.netPnl >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtMoney(t.netPnl)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Active alerts">
            {!alerts.data?.items.length ? <Empty>No alert rules.</Empty> : (
              <ul className="space-y-1 text-sm">
                {alerts.data.items.slice(0, 4).map((a) => (
                  <li key={a.id} className="text-slate-300">{a.symbol} · {a.type === "SIGNAL_BUY" ? "scanner BUY" : `${a.type === "PRICE_ABOVE" ? "above" : "below"} ${a.value}`}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <p className="text-xs text-slate-500">{q?.note}</p>
    </div>
  );
}
