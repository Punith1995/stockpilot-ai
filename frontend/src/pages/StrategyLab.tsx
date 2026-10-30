import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtMoney, fmtNum } from "../lib/format";
import type { SweepRow } from "../types";
import { btn, Card, ErrorBox, input } from "../components/Card";

const parseList = (s: string) => s.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));

export function StrategyLab() {
  const adminToken = useAdmin((s) => s.adminToken);
  const [symbol, setSymbol] = useState("TCS");
  const [targets, setTargets] = useState("1.5, 2");
  const [atrs, setAtrs] = useState("1, 1.5");
  const t = parseList(targets), a = parseList(atrs);
  const combos = t.length * a.length;
  const sweep = useMutation({
    mutationFn: () => api<{ rows: SweepRow[]; warning: string; combinations: number }>("/strategy-lab/sweep", { method: "POST", adminToken, body: { symbol, days: 40, targetR: t, atrMultiple: a, oosFraction: 0.3 } }),
  });
  return (
    <div className="grid gap-4">
      <Card title="Strategy lab · parameter sweep · SAMPLE">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label>Symbol<br /><input className={input} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></label>
          <label>Target R values<br /><input className={input} value={targets} onChange={(e) => setTargets(e.target.value)} /></label>
          <label>ATR multiples<br /><input className={input} value={atrs} onChange={(e) => setAtrs(e.target.value)} /></label>
          <button className={btn} onClick={() => sweep.mutate()} disabled={!adminToken || combos < 1 || combos > 9 || sweep.isPending}>{sweep.isPending ? "Running…" : `Run ${combos} combinations`}</button>
        </div>
        {combos > 9 && <p className="mt-2 text-sm text-red-300">At most 9 combinations.</p>}
        {!adminToken && <p className="mt-2 text-sm text-amber-300">Enter the admin token on the Connection page to run a sweep.</p>}
        <div className="mt-2"><ErrorBox error={sweep.error} /></div>
        <p className="mt-3 text-xs text-slate-500">Each combination is tested on the earlier 70% and then the last 30% of sessions. Rows are ranked by the out-of-sample result.</p>
      </Card>
      {sweep.data && (
        <Card title="Results">
          <p className="mb-3 rounded border border-amber-800 bg-amber-950/40 p-2 text-sm text-amber-200">{sweep.data.warning}</p>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Target R</th><th>ATR ×</th><th>In-sample trades</th><th>In-sample P&amp;L</th><th>OOS trades</th><th>OOS P&amp;L</th><th>OOS profit factor</th><th>OOS max DD</th></tr></thead>
            <tbody>
              {sweep.data.rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="py-1.5">{r.targetR}</td><td>{r.atrMultiple}</td>
                  <td>{r.inSample.trades}</td><td>{fmtMoney(r.inSample.netProfit)}</td>
                  <td>{r.outOfSample.trades}</td><td className={r.outOfSample.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtMoney(r.outOfSample.netProfit)}</td>
                  <td>{r.outOfSample.profitFactor == null ? "n/a" : fmtNum(r.outOfSample.profitFactor)}</td><td>{fmtNum(r.outOfSample.maxDrawdownPct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
