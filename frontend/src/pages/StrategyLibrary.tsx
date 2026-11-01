import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst, fmtMoney, fmtPct } from "../lib/format";
import type { BacktestResult, LibraryPreset, SimpleCompareResponse, SimpleStrategyInfo } from "../types";
import { btn, Card, Empty, ErrorBox, input } from "../components/Card";
import { useDataSource } from "../lib/source";

export function StrategyLibrary() {
  const src = useDataSource();
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const q = useQuery({ queryKey: ["library"], queryFn: () => api<{ builtIn: { name: string }; saved: LibraryPreset[]; note: string }>("/strategy-library") });
  const [name, setName] = useState("");
  const [rsiMin, setRsiMin] = useState(55);
  const [rsiMax, setRsiMax] = useState(70);
  const [minAdx, setMinAdx] = useState(20);
  const [targetR, setTargetR] = useState(2);
  const bad = rsiMin > rsiMax;
  const save = useMutation({
    mutationFn: () => api<LibraryPreset>("/strategy-library", { method: "POST", adminToken, body: { name, overrides: { rsiMin, rsiMax, minAdx, targetR } } }),
    onSuccess: () => { setName(""); qc.invalidateQueries({ queryKey: ["library"] }); },
  });
  const registry = useQuery({ queryKey: ["registry"], queryFn: () => api<{ items: { id: string; name: string; enabled: boolean; builtIn: boolean; editable?: boolean; params?: { targetR: number; maxHoldBars: number; stopAtr?: number; edited: boolean } | null }[]; note: string }>("/strategy-registry") });
  const backtests = useQuery({ queryKey: ["backtests"], queryFn: () => api<{ items: BacktestResult[] }>("/backtests") });
  const lastRun = (id: string) => [...(backtests.data?.items ?? [])].reverse().find((b) => b.strategyId === id);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ targetR: number; maxHoldBars: number; stopAtr?: number }>({ targetR: 2, maxHoldBars: 20 });
  const saveParams = useMutation({
    mutationFn: (v: { id: string; targetR: number; maxHoldBars: number; stopAtr?: number }) => api(`/strategy-params/${v.id}`, { method: "PUT", adminToken, body: { targetR: v.targetR, maxHoldBars: v.maxHoldBars, ...(v.stopAtr != null ? { stopAtr: v.stopAtr } : {}) } }),
    onSuccess: () => { setEditId(null); qc.invalidateQueries({ queryKey: ["registry"] }); qc.invalidateQueries({ queryKey: ["simple"] }); },
  });
  const startEdit = (id: string) => {
    const p = registry.data?.items.find((i) => i.id === id)?.params;
    setEdit({ targetR: p?.targetR ?? 2, maxHoldBars: p?.maxHoldBars ?? 20, stopAtr: p?.stopAtr });
    setEditId(id);
  };
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => api(`/strategy-registry/${v.id}`, { method: "PUT", adminToken, body: { enabled: v.enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registry"] }),
  });
  const isOn = (id: string) => registry.data?.items.find((i) => i.id === id)?.enabled ?? true;
  const dup = useMutation({
    mutationFn: (p: LibraryPreset) => api<LibraryPreset>("/strategy-library", { method: "POST", adminToken, body: { name: `${p.name} (copy)`.slice(0, 60), overrides: p.overrides } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
  });
  const simple = useQuery({ queryKey: ["simple"], queryFn: () => api<{ items: SimpleStrategyInfo[]; note: string }>("/strategies/simple") });
  const [symbol, setSymbol] = useState("TCS");
  const compare = useMutation({
    mutationFn: () => api<SimpleCompareResponse>("/strategies/compare", { method: "POST", adminToken, body: { symbol, days: 40, oosFraction: 0.3 } }),
  });
  return (
    <div className="grid gap-4">
      <Card title={`Strategies (${simple.data?.items.length ?? 0})`}>
        <ErrorBox error={simple.error} />
        {simple.data && (
          <>
            <p className="mb-3 text-xs text-amber-200">{simple.data.note}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {simple.data.items.map((s) => (
                <div key={s.id} className="rounded border border-slate-800 p-3 text-sm">
                  <div className="flex items-center justify-between"><span className="font-medium">{s.name}</span><span className="text-xs text-slate-400">{s.product}</span></div>
                  <p className="mt-1 text-slate-300">{s.summary}</p>
                  <p className="mt-1 text-xs text-slate-400">Best for: {s.bestFor} · target {registry.data?.items.find((i) => i.id === s.id)?.params?.targetR ?? s.targetR}R · max hold {registry.data?.items.find((i) => i.id === s.id)?.params?.maxHoldBars ?? s.maxHoldBars} bars{registry.data?.items.find((i) => i.id === s.id)?.params?.edited ? " (edited)" : ""}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <span className={`rounded px-2 py-0.5 ${isOn(s.id) ? "bg-emerald-900/40 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>{isOn(s.id) ? "Enabled" : "Disabled"}</span>
                    <span className="text-slate-400">Universe: {src.live ? "All NSE equities (live)" : "Sample list (5 stocks)"}</span>
                    <span className="text-slate-400">Last backtest: {lastRun(s.id) ? `${fmtIst(new Date(lastRun(s.id)!.createdAt).getTime())} · ${fmtMoney(lastRun(s.id)!.metrics.netProfit)} · ${lastRun(s.id)!.metrics.trades} trades` : "none yet"}</span>
                    <Link to="/backtest" className="text-sky-400 underline">Backtest</Link>
                    <button className={btn} disabled={!adminToken || toggle.isPending} onClick={() => toggle.mutate({ id: s.id, enabled: !isOn(s.id) })}>{isOn(s.id) ? "Disable" : "Enable"}</button>
                    <button className={btn} disabled={!adminToken} onClick={() => startEdit(s.id)} title={adminToken ? "Edit target and max hold" : "Enter the admin token on the Connection page"}>Edit</button>
                  </div>
                  {editId === s.id && (
                    <div className="mt-3 grid gap-2 rounded border border-slate-700 p-2 text-xs md:grid-cols-[1fr_1fr_auto]">
                      <label>Target (R multiple)<input className={`${input} mt-1 w-full`} type="number" step="0.1" min={0.5} max={10} value={edit.targetR} onChange={(e) => setEdit({ ...edit, targetR: Number(e.target.value) })} /></label>
                      <label>Max hold (bars)<input className={`${input} mt-1 w-full`} type="number" min={1} max={500} value={edit.maxHoldBars} onChange={(e) => setEdit({ ...edit, maxHoldBars: Number(e.target.value) })} /></label>
                      {edit.stopAtr != null && <label className="md:col-span-3">Stop distance (ATR multiple)<input className={`${input} mt-1 w-full md:w-48`} type="number" step="0.1" min={0.5} max={5} value={edit.stopAtr} onChange={(e) => setEdit({ ...edit, stopAtr: Number(e.target.value) })} /></label>}
                      <div className="flex items-end gap-2">
                        <button className={btn} onClick={() => saveParams.mutate({ id: s.id, ...edit })} disabled={saveParams.isPending}>Save</button>
                        <button className={btn} onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                      <p className="md:col-span-3 text-slate-500">{edit.stopAtr != null ? "Stop is entry minus this many ATRs. " : "This strategy's stop rule is fixed. "}Edits apply to new backtests and comparisons.</p>
                      <ErrorBox error={saveParams.error} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
      <Card title={`Compare on ${src.word} data`} actions={
        <div className="flex items-center gap-2">
          <input className={`${input} w-28`} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} aria-label="Symbol" />
          <button className={btn} onClick={() => compare.mutate()} disabled={!adminToken || !symbol || compare.isPending}>Compare</button>
        </div>
      }>
        {!adminToken && <p className="mb-2 text-sm text-amber-300">Enter the admin token on the Connection page to run the comparison.</p>}
        <ErrorBox error={compare.error} />
        {compare.data && (
          <>
            <p className="mb-2 text-xs text-slate-400">Ranked by out-of-sample net profit (last 30% of sessions). {src.word} data.</p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Strategy</th><th>Trades (OOS)</th><th>Win rate (OOS)</th><th>Net P&amp;L (OOS)</th><th>Net P&amp;L (full)</th><th>Max DD (OOS)</th></tr></thead>
              <tbody>
                {compare.data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td className="py-2">{r.name}</td>
                    <td>{r.outOfSample.trades}</td>
                    <td>{fmtPct(r.outOfSample.winRate)}</td>
                    <td className={r.outOfSample.netProfit >= 0 ? "text-emerald-300" : "text-red-300"}>{fmtMoney(r.outOfSample.netProfit)}</td>
                    <td>{fmtMoney(r.full.netProfit)}</td>
                    <td>{fmtPct(r.outOfSample.maxDrawdownPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-amber-200">{compare.data.warning}</p>
          </>
        )}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
      <Card title="Strategies">
        <ErrorBox error={q.error} />
        {q.data && (
          <ul className="space-y-2 text-sm">
            <li className="rounded border border-slate-800 p-2"><span className="font-medium">{q.data.builtIn.name}</span>
              <span className={`ml-2 rounded px-2 py-0.5 text-xs ${isOn("ema-momentum-pro") ? "bg-emerald-900/40 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>{isOn("ema-momentum-pro") ? "Enabled" : "Disabled"}</span>
              <div className="mt-2 flex gap-2">
                <button className={btn} disabled={!adminToken || toggle.isPending} onClick={() => toggle.mutate({ id: "ema-momentum-pro", enabled: !isOn("ema-momentum-pro") })}>{isOn("ema-momentum-pro") ? "Disable" : "Enable"}</button>
                <Link to="/strategy" className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700">Edit in Strategy Builder</Link>
              </div></li>
            {q.data.saved.map((p) => (
              <li key={p.id} className="rounded border border-slate-800 p-2">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-slate-400">{Object.entries(p.overrides).map(([k, v]) => `${k}=${v}`).join(" · ") || "no overrides"} · saved {fmtIst(new Date(p.createdAt).getTime())}</div>
                <div className="mt-2 flex gap-2">
                  <button className={btn} disabled={!adminToken || dup.isPending} onClick={() => dup.mutate(p)}>Duplicate</button>
                  <Link to="/strategy" className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700">Open in builder</Link>
                </div>
              </li>
            ))}
            {!q.data.saved.length && <Empty>No saved presets yet.</Empty>}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">{q.data?.note}</p>
      </Card>
      <Card title="Save a preset" actions={<button className={btn} onClick={() => save.mutate()} disabled={!adminToken || !name.trim() || bad || save.isPending}>Save</button>}>
        <input className={`${input} mb-3 w-full`} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Preset name" aria-label="Preset name" />
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>RSI min<input className={`${input} mt-1 w-full`} type="number" value={rsiMin} onChange={(e) => setRsiMin(Number(e.target.value))} /></label>
          <label>RSI max<input className={`${input} mt-1 w-full`} type="number" value={rsiMax} onChange={(e) => setRsiMax(Number(e.target.value))} /></label>
          <label>Min ADX<input className={`${input} mt-1 w-full`} type="number" value={minAdx} onChange={(e) => setMinAdx(Number(e.target.value))} /></label>
          <label>Target (R)<input className={`${input} mt-1 w-full`} type="number" step="0.1" value={targetR} onChange={(e) => setTargetR(Number(e.target.value))} /></label>
        </div>
        {bad && <p className="mt-2 text-sm text-red-300">RSI min must not exceed RSI max.</p>}
        {!adminToken && <p className="mt-2 text-sm text-amber-300">Enter the admin token on the Connection page to save.</p>}
        <ErrorBox error={save.error} />
      </Card>
    </div>
    </div>
  );
}
