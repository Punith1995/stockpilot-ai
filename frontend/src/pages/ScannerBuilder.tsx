import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ScanRow, StrategyInfo } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, ErrorBox, input } from "../components/Card";
import { fmtIst, fmtMoney } from "../lib/format";
import { useAdmin } from "../lib/store";
import { useDataSource } from "../lib/source";

interface SavedScanner { id: string; name: string; savedAt: string; universe: Universe; interval: string; customRules: { left: string; op: (typeof OPS)[number]; right: { type: "value"; value: number } | { type: "indicator"; name: string } }[]; customMatch: "all" | "any" }

type Mode = "mandatory" | "optional" | "off";
type Universe = "SAMPLE_STOCKS" | "CUSTOM";
const MODE_LABEL: Record<Mode, string> = { mandatory: "Mandatory", optional: "Optional", off: "Off" };

const INDICATOR_CATEGORIES: Record<string, { id: string; label: string }[]> = {
  Price: [{ id: "close", label: "Close" }],
  Trend: [{ id: "ema20", label: "EMA 20" }, { id: "ema50", label: "EMA 50" }, { id: "ema200", label: "EMA 200" }],
  Momentum: [{ id: "rsi14", label: "RSI 14" }, { id: "macd", label: "MACD line" }, { id: "macdSignal", label: "MACD signal" }],
  Strength: [{ id: "adx14", label: "ADX 14" }],
  Volatility: [{ id: "atr14", label: "ATR 14" }, { id: "bbUpper", label: "Bollinger upper" }, { id: "bbLower", label: "Bollinger lower" }],
  Volume: [{ id: "relVolume", label: "Relative volume (20)" }],
};
const ALL_INDICATORS = Object.values(INDICATOR_CATEGORIES).flat();
const OPS = [">", "<", ">=", "<="] as const;
interface RuleLike { left: string; op: (typeof OPS)[number]; rightType: "value" | "indicator"; value: number; rightInd: string }
const toApi = (r: RuleLike) => ({ left: r.left, op: r.op, right: r.rightType === "value" ? { type: "value" as const, value: r.value } : { type: "indicator" as const, name: r.rightInd } });
interface Rule { id: number; left: string; op: (typeof OPS)[number]; rightType: "value" | "indicator"; value: number; rightInd: string }

export function ScannerBuilder() {
  const src = useDataSource();
  const strat = useQuery({ queryKey: ["strategies"], queryFn: () => api<StrategyInfo>("/strategies") });
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [rsiMin, setRsiMin] = useState(55);
  const [rsiMax, setRsiMax] = useState(70);
  const [minRv, setMinRv] = useState(1.5);
  const [minAdx, setMinAdx] = useState(20);
  const [interval, setInterval] = useState("5");
  const [universe, setUniverse] = useState<Universe>("SAMPLE_STOCKS");
  const [customSymbols, setCustomSymbols] = useState("TCS, INFY, RELIANCE");
  const [category, setCategory] = useState("All");
  const [rules, setRules] = useState<Rule[]>([]);
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const qc = useQueryClient();
  const adminToken = useAdmin((st) => st.adminToken);
  const [saveName, setSaveName] = useState("");
  const savedList = useQuery({ queryKey: ["scanners"], queryFn: () => api<{ items: SavedScanner[] }>("/scanners") });
  const savedItems: SavedScanner[] = savedList.data?.items ?? [];
  const saveScanner = useMutation({
    mutationFn: () => api<SavedScanner>("/scanners", { method: "POST", adminToken, body: { name: saveName.trim(), universe, interval, customMatch: matchMode, customRules: rules.map(toApi) } }),
    onSuccess: () => { setSaveName(""); qc.invalidateQueries({ queryKey: ["scanners"] }); },
  });
  const loadScanner = (sc: SavedScanner) => {
    setUniverse(sc.universe); setInterval(sc.interval); setMatchMode(sc.customMatch);
    setRules(sc.customRules.map((r, i) => ({ id: Date.now() + i, left: r.left, op: r.op, rightType: r.right.type === "value" ? "value" : "indicator", value: r.right.type === "value" ? r.right.value : 0, rightInd: r.right.type === "indicator" ? r.right.name : "ema50" })));
  };
  const indicatorOptions = category === "All" ? ALL_INDICATORS : INDICATOR_CATEGORIES[category] ?? [];
  const addRule = () => setRules([...rules, { id: Date.now(), left: indicatorOptions[0]?.id ?? "close", op: ">", rightType: "value", value: 0, rightInd: "ema50" }]);
  const updateRule = (id: number, patch: Partial<Rule>) => setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const rulesBad = rules.some((r) => r.rightType === "value" && !Number.isFinite(r.value));
  const bad = rsiMin > rsiMax;
  const symbols = customSymbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const badUniverse = universe === "CUSTOM" && symbols.length === 0;

  const run = useMutation({
    mutationFn: () => {
      const conditions: Record<string, { enabled: boolean; mandatory: boolean }> = {};
      for (const [id, m] of Object.entries(modes)) conditions[id] = { enabled: m !== "off", mandatory: m === "mandatory" };
      return api<{ universe: string; interval: number; customApplied: boolean; customMatch?: "all" | "any"; count: number; scanned: number; customRules: unknown[]; results: (ScanRow & { preview?: { close: number | null; rsi14: number | null; adx14: number | null; relVolume: number | null } })[] }>("/scanner/run", {
        method: "POST",
        body: {
          universe, interval, ...(universe === "CUSTOM" ? { symbols } : {}),
          config: { conditions, rsiMin, rsiMax, minRelativeVolume: minRv, minAdx },
          customRules: rules.map(toApi),
          customMatch: matchMode,
        },
      });
    },
  });
  const modeOf = (id: string): Mode => modes[id] ?? (strat.data?.config.conditions[id]?.mandatory ? "mandatory" : "optional");
  const name = (id: string) => strat.data?.labels[id] ?? id;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Scanner builder · conditions" actions={<button className={btn} onClick={() => run.mutate()} disabled={bad || badUniverse || rulesBad || run.isPending}>{run.isPending ? "Scanning…" : "Run scanner"}</button>}>
        <ErrorBox error={run.error} />
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
          <label>Timeframe
            <select className={`${input} mt-1 w-full`} value={interval} onChange={(e) => setInterval(e.target.value)} aria-label="Timeframe">
              <option value="1">1 min</option><option value="5">5 min</option><option value="15">15 min</option>
            </select>
          </label>
          <label>Universe
            <select className={`${input} mt-1 w-full`} value={universe} onChange={(e) => setUniverse(e.target.value as Universe)} aria-label="Universe">
              <option value="SAMPLE_STOCKS">Sample stocks (5)</option><option value="CUSTOM">Custom list</option>
            </select>
          </label>
          {universe === "CUSTOM" && (
            <label className="col-span-2">Symbols (comma separated, sample list only)
              <input className={`${input} mt-1 w-full`} value={customSymbols} onChange={(e) => setCustomSymbols(e.target.value)} aria-label="Custom symbols" />
            </label>
          )}
          {badUniverse && <p className="col-span-2 text-red-300">Enter at least one symbol.</p>}
        </div>
        {strat.data && (
          <table className="mb-4 w-full text-sm">
            <tbody>
              {Object.keys(strat.data?.labels ?? {}).map((id) => (
                <tr key={id} className="border-t border-slate-800">
                  <td className="py-1.5">{name(id)}</td>
                  <td className="text-right">
                    <span className="inline-flex gap-1" role="group" aria-label={`${name(id)} mode`}>
                      {(Object.keys(MODE_LABEL) as Mode[]).map((m) => {
                        const on = modeOf(id) === m;
                        return (
                          <button key={m} type="button" aria-pressed={on} onClick={() => setModes({ ...modes, [id]: m })}
                            className={`rounded border px-2 py-1 text-xs ${on ? "border-sky-600 bg-sky-900/60 text-sky-100" : "border-slate-700 text-slate-300 hover:bg-slate-800"}`}>
                            {MODE_LABEL[m]}
                          </button>
                        );
                      })}
                    </span>
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
        <div className="mt-4 rounded border border-slate-800 p-3">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <label className="text-sm">Indicator category<br />
              <select className={input} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Indicator category">
                <option>All</option>{Object.keys(INDICATOR_CATEGORIES).map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <label className="text-sm">Match<br />
                <select className={input} value={matchMode} onChange={(e) => setMatchMode(e.target.value as "all" | "any")} aria-label="Match mode">
                  <option value="all">All rules (AND)</option><option value="any">Any rule (OR)</option>
                </select>
              </label>
              <button className={btn} onClick={addRule} disabled={rules.length >= 10}>Add rule</button>
            </div>
          </div>
          {!rules.length && <p className="text-sm text-slate-500">No custom rules. Add one to filter the scan, for example Close &gt; EMA 50.</p>}
          <div className="space-y-2">
            {rules.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <select className={input} value={r.left} onChange={(e) => updateRule(r.id, { left: e.target.value })} aria-label="Left indicator">
                  {indicatorOptions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
                <select className={input} value={r.op} onChange={(e) => updateRule(r.id, { op: e.target.value as Rule["op"] })} aria-label="Operator">
                  {OPS.map((o) => <option key={o}>{o}</option>)}
                </select>
                <select className={input} value={r.rightType} onChange={(e) => updateRule(r.id, { rightType: e.target.value as Rule["rightType"] })} aria-label="Compare with">
                  <option value="value">a number</option><option value="indicator">another indicator</option>
                </select>
                {r.rightType === "value"
                  ? <input className={`${input} w-28`} type="number" step="0.01" value={r.value} onChange={(e) => updateRule(r.id, { value: Number(e.target.value) })} aria-label="Value" />
                  : <select className={input} value={r.rightInd} onChange={(e) => updateRule(r.id, { rightInd: e.target.value })} aria-label="Other indicator">
                      {ALL_INDICATORS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>}
                <button className="text-xs text-red-300 underline" onClick={() => setRules(rules.filter((x) => x.id !== r.id))}>Remove</button>
              </div>
            ))}
          </div>
          {rulesBad && <p className="mt-2 text-sm text-red-300">Enter a number for each value rule.</p>}
          <p className="mt-2 text-xs text-slate-500">Custom rules are checked on the last closed bar. A stock must pass every rule to appear. Rules are evaluated on {src.word} data.</p>
        </div>
        {bad && <p className="mt-2 text-sm text-red-300">RSI min must not exceed RSI max.</p>}
        <p className="mt-3 text-xs text-slate-500">Mandatory conditions must all pass for BUY. Optional ones are shown but do not block a signal. Off conditions are ignored.</p>
      </Card>

      <Card title={`Matching stocks preview · ${src.word}${run.data ? ` · ${run.data.interval} min` : ""}`}>
        <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded border border-slate-800 p-2"><div className="text-xs text-slate-500">Total conditions</div><div className="font-semibold">{Object.values(modes).filter((m) => m !== "off").length + rules.length} <span className="text-xs font-normal text-slate-500">(built-in + custom)</span></div></div>
          <div className="rounded border border-slate-800 p-2"><div className="text-xs text-slate-500">Selected timeframe</div><div className="font-semibold">{interval} min</div></div>
          <div className="rounded border border-slate-800 p-2"><div className="text-xs text-slate-500">Matching stocks</div><div className="font-semibold">{run.data ? `${run.data.results.length} of ${run.data.scanned ?? run.data.results.length}` : "—"}</div></div>
        </div>
        {!run.data && !run.isPending && <p className="text-sm text-slate-500">Set conditions and run the scanner.</p>}
        {run.data && run.data.customApplied && <p className="mb-2 text-sm text-sky-200">{run.data.count} of {run.data.scanned} stocks match {run.data.customMatch === "any" ? "any" : "all"} of {run.data.customRules.length} custom rule{run.data.customRules.length === 1 ? "" : "s"}.</p>}
        {run.data && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Signal</th><th>Passed</th><th>Close</th><th>RSI 14</th><th>ADX 14</th><th>Rel. vol</th><th>Plan</th></tr></thead>
            <tbody>
              {run.data.results.map((r) => (
                <tr key={r.symbol} className="border-t border-slate-800">
                  <td className="py-1.5">{r.symbol}</td>
                  <td><Badge tone={r.signal === "BUY" ? "green" : "slate"}>{r.signal}</Badge></td>
                  <td>{r.passedChecks}/{r.totalChecks}</td>
                  <td>{r.preview?.close == null ? "—" : fmtMoney(r.preview.close)}</td><td>{r.preview?.rsi14 == null ? "—" : r.preview.rsi14.toFixed(1)}</td><td>{r.preview?.adx14 == null ? "—" : r.preview.adx14.toFixed(1)}</td><td>{r.preview?.relVolume == null ? "—" : `${r.preview.relVolume.toFixed(2)}×`}</td>
                  <td className="text-slate-300">{r.plan ? `${fmtMoney(r.plan.entry)} → stop ${fmtMoney(r.plan.stop)}, target ${fmtMoney(r.plan.target)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title={`Save scanner · ${src.word}`}>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex-1">Name<br /><input className={`${input} w-full`} maxLength={60} value={saveName} onChange={(e) => setSaveName(e.target.value)} aria-label="Scanner name" /></label>
          <button className={btn} onClick={() => saveScanner.mutate()} disabled={!adminToken || !saveName.trim() || rulesBad || saveScanner.isPending}>Save scanner</button>
        </div>
        {!adminToken && <p className="mt-2 text-xs text-amber-300">Enter the admin token on the Connection page to save scanners.</p>}
        <ErrorBox error={saveScanner.error} />
        <ul className="mt-3 space-y-2 text-sm">
          {savedItems.map((sc) => (
            <li key={sc.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 p-2">
              <span>{sc.name} <span className="text-xs text-slate-500">· {sc.customRules.length} rule{sc.customRules.length === 1 ? "" : "s"} · {sc.interval} min · {fmtIst(new Date(sc.savedAt).getTime())}</span></span>
              <button className={btn} onClick={() => loadScanner(sc)}>Load</button>
            </li>
          ))}
          {savedList.data && !savedItems.length && <li className="text-slate-500">No saved scanners yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
