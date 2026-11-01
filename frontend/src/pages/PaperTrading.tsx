import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst, fmtMoney, REASON_LABELS } from "../lib/format";
import type { Instrument, PaperSnapshot, QuotesResponse } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, Empty, ErrorBox, input, Tile } from "../components/Card";

const TABS = ["Positions", "Orders", "Trade history"] as const;
const pnlTone = (n: number) => (n >= 0 ? "text-emerald-300" : "text-red-300");
const istDay = (ms: number) => Math.floor((ms + 19_800_000) / 86_400_000);

/** Paper trading only. Virtual orders are simulated at the last close and never reach a broker. */
export function PaperTrading() {
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Positions");
  const paper = useQuery({ queryKey: ["paper"], queryFn: () => api<PaperSnapshot>("/paper"), refetchInterval: 10_000 });
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: () => api<QuotesResponse>("/market/quotes"), refetchInterval: 30_000 });
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const scan = useMutation({ mutationFn: () => api("/paper/scan", { method: "POST", adminToken }), onSuccess: () => qc.invalidateQueries({ queryKey: ["paper"] }) });
  const stop = useMutation({ mutationFn: (active: boolean) => api("/paper/emergency-stop", { method: "POST", adminToken, body: { active } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["paper"] }) });
  const [oSym, setOSym] = useState("INFY");
  const [qty, setQty] = useState(1);
  const [oStop, setOStop] = useState(0);
  const [oTarget, setOTarget] = useState(0);
  const place = useMutation({
    mutationFn: () => api("/paper/order", { method: "POST", adminToken, body: { symbol: oSym, qty, stop: oStop, target: oTarget } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["paper"] }),
  });

  const p = paper.data;
  const last = new Map((quotes.data?.stocks ?? []).map((q) => [q.symbol, q.last]));
  const lastOrder = last.get(oSym) ?? null;
  const invested = p?.positions.reduce((s, x) => s + x.qty * x.entry, 0) ?? 0;
  const unrealized = (p?.positions ?? []).reduce((s, x) => s + x.qty * ((last.get(x.symbol) ?? x.entry) - x.entry), 0);
  const today = istDay(Date.now());
  const todayPnl = (p?.trades ?? []).filter((t) => istDay(t.exitTime) === today).reduce((s, t) => s + t.netPnl, 0);
  const charges = (p?.trades ?? []).reduce((s, t) => s + (t.costs ?? 0), 0);
  const orderOk = lastOrder != null && oStop > 0 && oStop < lastOrder && oTarget > lastOrder && qty >= 1;

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm font-semibold text-amber-200">PAPER TRADING · virtual money · no real orders are placed</div>
      <ErrorBox error={paper.error ?? scan.error ?? stop.error ?? place.error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Paper status" value={p?.emergencyStop ? "Emergency stop" : "Running"} tone={p?.emergencyStop ? "text-red-300" : "text-emerald-300"} />
        <Tile label="Virtual capital" value={fmtMoney(p?.startCapital ?? null)} />
        <Tile label="Available balance" value={fmtMoney(p?.cash ?? null)} />
        <Tile label="Today's P&L" value={fmtMoney(p ? todayPnl : null)} tone={pnlTone(todayPnl)} />
        <Tile label="Open positions" value={p ? `${p.positions.length} / 5` : "—"} />
        <Tile label="Unrealized P&L" value={fmtMoney(p ? unrealized : null)} tone={pnlTone(unrealized)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="Paper account" actions={
          <div className="flex flex-wrap gap-2">
            <button className={btn} onClick={() => scan.mutate()} disabled={!adminToken || scan.isPending}>Scan sample data</button>
            <button className="rounded-md border border-red-800 bg-red-950 px-3 py-1.5 text-sm text-red-200 disabled:opacity-50" onClick={() => stop.mutate(!p?.emergencyStop)} disabled={!adminToken || stop.isPending}>
              {p?.emergencyStop ? "Clear emergency stop" : "Emergency stop + flatten"}
            </button>
          </div>
        }>
          {!adminToken && <p className="mb-2 text-sm text-amber-300">Enter the admin token on the <Link to="/connection" className="underline">Connection page</Link> to place or scan paper orders, or to change the stop.</p>}
          <p className="text-sm text-slate-300">Emergency stop: {p?.emergencyStop ? <Badge tone="red">ON, no new entries</Badge> : <Badge tone="green">Off</Badge>}</p>
          <p className="mt-2 text-xs text-slate-500">Capital invested at cost: {fmtMoney(invested)}. Brokerage and charges so far: {fmtMoney(charges)} (already included in net P&L).</p>
        </Card>

        <Card title="Simulated order · PAPER">
          <div className="grid gap-3 text-sm">
            <label>Stock<select className={`${input} mt-1 w-full`} value={oSym} onChange={(e) => setOSym(e.target.value)}>{(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-2">
              <label>Side<select className={`${input} mt-1 w-full`} disabled><option>Buy</option></select></label>
              <label>Order type<select className={`${input} mt-1 w-full`} disabled><option>Market (last close)</option></select></label>
            </div>
            <label>Quantity<input className={`${input} mt-1 w-full`} type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></label>
            <label>Stop-loss (₹)<input className={`${input} mt-1 w-full`} type="number" step="0.05" value={oStop || ""} onChange={(e) => setOStop(Number(e.target.value))} /></label>
            <label>Target (₹)<input className={`${input} mt-1 w-full`} type="number" step="0.05" value={oTarget || ""} onChange={(e) => setOTarget(Number(e.target.value))} /></label>
            <p className="text-xs text-slate-400">Last price: {lastOrder == null ? "—" : fmtMoney(lastOrder)}. Stop must be below and target above the last price. Risk limits apply.</p>
            <button className={btn} onClick={() => place.mutate()} disabled={!adminToken || !orderOk || place.isPending}>{place.isPending ? "Placing…" : "Place simulated order"}</button>
            {place.isSuccess && <p className="text-xs text-emerald-300">Simulated order filled at {fmtMoney(lastOrder)}.</p>}
          </div>
        </Card>
      </div>

      <div role="tablist" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>{t}</button>
        ))}
      </div>

      {tab === "Positions" && (
        <Card>
          {!p?.positions.length ? <Empty>No open paper positions.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Qty</th><th>Entry</th><th>Last</th><th>Stop</th><th>Target</th><th>Unrealized P&amp;L</th><th>Strategy and entry reason</th></tr></thead>
                <tbody>{p.positions.map((x) => {
                  const lp = last.get(x.symbol) ?? x.entry;
                  const u = x.qty * (lp - x.entry);
                  return <tr key={x.symbol} className="border-t border-slate-800"><td className="py-1.5">{x.symbol}</td><td>{x.qty}</td><td>{fmtMoney(x.entry)}</td><td>{fmtMoney(lp)}</td><td>{fmtMoney(x.stop)}</td><td>{fmtMoney(x.target)}</td><td className={pnlTone(u)}>{fmtMoney(u)}</td><td className="max-w-[18rem] text-xs"><div className="text-slate-200">{x.strategy ?? "—"}</div><div className="text-slate-500">{x.entryReason ?? ""}</div></td></tr>;
                })}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "Orders" && (
        <Card>
          {!p?.orders.length ? <Empty>No paper orders yet. Place a simulated order or run a scan.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">ID</th><th>Symbol</th><th>Status</th><th>Fill</th><th>Note</th></tr></thead>
                <tbody>{[...p.orders].reverse().map((o) => <tr key={o.id} className="border-t border-slate-800"><td className="py-1.5">{o.id}</td><td>{o.symbol}</td><td><Badge tone={o.status === "FILLED" ? "green" : o.status === "REJECTED" ? "red" : "amber"}>{o.status}</Badge></td><td>{o.fillPrice ? fmtMoney(o.fillPrice) : "—"}</td><td className="text-slate-400">{o.reason ?? ""}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "Trade history" && (
        <Card>
          {!p?.trades.length ? <Empty>No closed paper trades.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Strategy and entry reason</th><th>Exit reason</th><th>Charges</th><th>Net P&amp;L</th></tr></thead>
                <tbody>{[...p.trades].reverse().map((t, i) => <tr key={i} className="border-t border-slate-800"><td className="py-1.5">{t.symbol}</td><td>{t.qty}</td><td>{fmtMoney(t.entry)}</td><td>{fmtMoney(t.exit)}</td><td className="max-w-[18rem] text-xs"><div className="text-slate-200">{t.strategy ?? "—"}</div><div className="text-slate-500">{t.entryReason ?? ""}</div></td><td>{REASON_LABELS[t.reason] ?? t.reason}</td><td>{fmtMoney(t.costs ?? 0)}</td><td className={pnlTone(t.netPnl)}>{fmtMoney(t.netPnl)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">Realized P&amp;L: {fmtMoney(p?.realizedPnl ?? null)}. Times are in the Trade Journal. Last refresh {fmtIst(Date.now())}.</p>
        </Card>
      )}
    </div>
  );
}
