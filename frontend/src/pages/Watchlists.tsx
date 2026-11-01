import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtMoney, fmtPct } from "../lib/format";
import type { Instrument, Watchlist } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, Empty, ErrorBox, input } from "../components/Card";

const INTERVALS = [["1", "1 min"], ["3", "3 min"], ["5", "5 min"], ["10", "10 min"], ["15", "15 min"], ["30", "30 min"], ["60", "1 hour"], ["240", "4 hour"]] as const;
const NAME_RE = /^[a-z0-9-]{1,30}$/;

interface OverviewRow {
  symbol: string; signal: "BUY" | "WAIT"; failedMandatory: string[]; passedChecks: number; totalChecks: number;
  price: number; changePct: number; trend: string; emaStatus: string; rsi: number | null; macd: number | null; adx: number | null; relVolume: number | null;
}
interface Overview { name: string; interval: number; items: OverviewRow[]; note: string }

/** Watchlists: create and edit lists, then review each list with the scanner rules on the chosen timeframe. */
export function Watchlists() {
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const lists = useQuery({ queryKey: ["watchlists"], queryFn: () => api<{ items: Watchlist[] }>("/watchlists") });
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const [name, setName] = useState("default");
  const [picked, setPicked] = useState<string[]>([]);
  const [interval, setInterval] = useState("5");
  const saved = lists.data?.items.some((w) => w.name === name) ?? false;
  const nameOk = NAME_RE.test(name);

  useEffect(() => {
    const w = lists.data?.items.find((x) => x.name === name);
    if (w) setPicked(w.symbols);
  }, [lists.data, name]);

  const overview = useQuery({
    queryKey: ["watchlist-overview", name, interval],
    queryFn: () => api<Overview>(`/watchlists/${encodeURIComponent(name)}/overview?interval=${interval}`),
    enabled: saved,
    refetchInterval: 60_000,
  });

  const save = useMutation({
    mutationFn: () => api(`/watchlists/${encodeURIComponent(name)}`, { method: "PUT", adminToken, body: { symbols: picked } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["watchlists"] }); qc.invalidateQueries({ queryKey: ["watchlist-overview"] }); },
  });

  const toggle = (sym: string) => setPicked((p) => (p.includes(sym) ? p.filter((s) => s !== sym) : [...p, sym]));
  const pick = (w: string) => setName(w);
  const newList = () => { setName(""); setPicked([]); };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-4">
          <Card title="Lists" actions={<button className={btn} onClick={newList}>New list</button>}>
            <ErrorBox error={lists.error} />
            {!lists.data?.items.length ? <Empty>No watchlists yet. Create one below.</Empty> : (
              <ul className="space-y-2 text-sm">
                {lists.data.items.map((w) => (
                  <li key={w.name}>
                    <button onClick={() => pick(w.name)} aria-pressed={w.name === name}
                      className={`flex w-full items-center justify-between rounded border p-2 text-left ${w.name === name ? "border-sky-600 bg-sky-950/40" : "border-slate-800"}`}>
                      <span className="font-medium">{w.name}</span>
                      <span className="text-xs text-slate-400">{w.symbols.length} stocks</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500">Lists are kept in memory and reset on restart.</p>
          </Card>

          <Card title="Edit list" actions={<button className={btn} onClick={() => save.mutate()} disabled={!adminToken || !nameOk || save.isPending}>{save.isPending ? "Saving…" : "Save list"}</button>}>
            <label className="mb-3 block text-sm">List name
              <input className={`${input} mt-1 w-full`} value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="a-z, 0-9, hyphen" />
            </label>
            {name && !nameOk && <p className="mb-2 text-sm text-red-300">Use only a-z, 0-9 and hyphens (max 30).</p>}
            {!adminToken && <p className="mb-2 text-sm text-amber-300">Enter the admin token on the Connection page to save.</p>}
            <p className="mb-2 text-sm text-slate-400">Stocks in this list ({picked.length})</p>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {(instruments.data?.items ?? []).map((i) => (
                <label key={i.symbol} className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.includes(i.symbol)} onChange={() => toggle(i.symbol)} />
                  <span>{i.symbol}</span> <span className="text-xs text-slate-500">{i.name}</span>
                </label>
              ))}
            </div>
            <div className="mt-3"><ErrorBox error={save.error} /></div>
            {save.isSuccess && <p className="mt-2 text-sm text-emerald-400">Saved.</p>}
          </Card>
        </div>

        <Card title={saved ? `Overview: ${name}` : "Overview"} actions={
          <label className="flex items-center gap-2 text-sm">Timeframe
            <select className={input} value={interval} onChange={(e) => setInterval(e.target.value)} disabled={!saved}>
              {INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        }>
          {!saved ? <Empty>Save the list first, then its overview appears here.</Empty> : (
            <>
              <ErrorBox error={overview.error} />
              {overview.data && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr><th className="py-2">Symbol</th><th>Price</th><th>Change</th><th>Trend</th><th>EMA status</th><th>RSI</th><th>MACD</th><th>Rel. vol</th><th>Signal</th><th></th></tr>
                    </thead>
                    <tbody>
                      {overview.data.items.map((r) => (
                        <tr key={r.symbol} className="border-t border-slate-800">
                          <td className="py-1.5 font-medium">{r.symbol}</td>
                          <td>{fmtMoney(r.price)}</td>
                          <td className={r.changePct >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtPct(r.changePct)}</td>
                          <td>{r.trend}</td>
                          <td>{r.emaStatus}</td>
                          <td>{r.rsi?.toFixed(1) ?? "—"}</td>
                          <td>{r.macd?.toFixed(2) ?? "—"}</td>
                          <td>{r.relVolume?.toFixed(2) ?? "—"}</td>
                          <td><Badge tone={r.signal === "BUY" ? "green" : "slate"}>{r.signal}</Badge></td>
                          <td><Link className="text-sky-400 underline" to={`/chart?symbol=${r.symbol}`}>Chart</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!overview.data.items.length && <Empty>This list has no stocks. Tick stocks and save.</Empty>}
                  <p className="mt-2 text-xs text-slate-500">{overview.data.note}</p>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
