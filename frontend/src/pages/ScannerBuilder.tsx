import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ScanRow, StrategyInfo } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, ErrorBox, input } from "../components/Card";
import { fmtMoney } from "../lib/format";

type Mode = "mandatory" | "optional" | "off";
const MODE_LABEL: Record<Mode, string> = { mandatory: "Mandatory", optional: "Optional", off: "Off" };

export function ScannerBuilder() {
  const strat = useQuery({ queryKey: ["strategies"], queryFn: () => api<StrategyInfo>("/strategies") });
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [rsiMin, setRsiMin] = useState(55);
  const [rsiMax, setRsiMax] = useState(70);
  const [minRv, setMinRv] = useState(1.5);
  const [minAdx, setMinAdx] = useState(20);
  const bad = rsiMin > rsiMax;

  const run = useMutation({
    mutationFn: () => {
      const conditions: Record<string, { enabled: boolean; mandatory: boolean }> = {};
      for (const [id, m] of Object.entries(modes)) conditions[id] = { enabled: m !== "off", mandatory: m === "mandatory" };
      return api<{ results: ScanRow[]; appliedConfig: unknown }>("/scanner/run", { method: "POST", body: { config: { conditions, rsiMin, rsiMax, minRelativeVolume: minRv, minAdx } } });
    },
  });
  const modeOf = (id: string): Mode => modes[id] ?? (strat.data?.config.conditions[id]?.mandatory ? "mandatory" : "optional");
  const name = (id: string) => strat.data?.labels[id] ?? id;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Scanner builder · conditions" actions={<button className={btn} onClick={() => run.mutate()} disabled={bad || run.isPending}>{run.isPending ? "Scanning…" : "Run"}</button>}>
        <ErrorBox error={run.error} />
        {strat.data && (
          <table className="mb-4 w-full text-sm">
            <tbody>
              {Object.keys(strat.data.labels).map((id) => (
                <tr key={id} className="border-t border-slate-800">
                  <td className="py-1.5">{name(id)}</td>
                  <td className="text-right">
                    <select className={input} value={modeOf(id)} onChange={(e) => setModes({ ...modes, [id]: e.target.value as Mode })} aria-label={name(id)}>
                      {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>RSI min<input className={`${input} mt-1 w-full`} type="number" value={rsiMin} onChange={(e) => setRsiMin(Number(e.target.value))} /></label>
          <label>RSI max<input className={`${input} mt-1 w-full`} type="number" value={rsiMax} onChange={(e) => setRsiMax(Number(e.target.value))} /></label>
          <label>Min relative volume<input className={`${input} mt-1 w-full`} type="number" step="0.1" value={minRv} onChange={(e) => setMinRv(Number(e.target.value))} /></label>
          <label>Min ADX<input className={`${input} mt-1 w-full`} type="number" value={minAdx} onChange={(e) => setMinAdx(Number(e.target.value))} /></label>
        </div>
        {bad && <p className="mt-2 text-sm text-red-300">RSI min must not exceed RSI max.</p>}
        <p className="mt-3 text-xs text-slate-500">Mandatory conditions must all pass for BUY. Optional ones are shown but do not block a signal. Off conditions are ignored.</p>
      </Card>

      <Card title="Results · SAMPLE">
        {!run.data && !run.isPending && <p className="text-sm text-slate-500">Set conditions and run the scan.</p>}
        {run.data && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Signal</th><th>Passed</th><th>Plan</th></tr></thead>
            <tbody>
              {run.data.results.map((r) => (
                <tr key={r.symbol} className="border-t border-slate-800">
                  <td className="py-1.5">{r.symbol}</td>
                  <td><Badge tone={r.signal === "BUY" ? "green" : "slate"}>{r.signal}</Badge></td>
                  <td>{r.passedChecks}/{r.totalChecks}</td>
                  <td className="text-slate-300">{r.plan ? `${fmtMoney(r.plan.entry)} → stop ${fmtMoney(r.plan.stop)}, target ${fmtMoney(r.plan.target)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
