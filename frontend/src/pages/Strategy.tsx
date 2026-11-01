import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import type { BacktestResult, ScanRow, StrategyInfo } from "../types";
import { fmtMoney, fmtPct } from "../lib/format";
import { Badge } from "../components/Badge";
import { btn, Card, ErrorBox, input } from "../components/Card";
import { useDataSource } from "../lib/source";

type Mode = "mandatory" | "optional" | "off";
const MODES: Mode[] = ["mandatory", "optional", "off"];
const ALWAYS = ["dataSufficiency", "riskPlan"];
const NAME_RE = /^[a-z0-9-]{1,30}$/;
const EXITS = [
  "Stop-loss: entry minus 1.5 ATR, or the recent swing low (set by the stop method)",
  "Profit target: entry plus the target (R) multiple of the risk per share",
  "EMA 20 crosses below EMA 50",
  "Maximum holding period: 20 bars",
];

interface Group { id: string; op: "AND" | "OR"; members: string[] }

/** Strategy Builder. Test runs use the scanner with these settings. Saved presets keep only the numeric thresholds. */
export function Strategy() {
  const src = useDataSource();
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const info = useQuery({ queryKey: ["strategies"], queryFn: () => api<StrategyInfo>("/strategies") });
  const [name, setName] = useState("My momentum setup");
  const [description, setDescription] = useState("Trend-following entries using EMA 20/50 with RSI and MACD confirmation.");
  const [direction, setDirection] = useState("bullish");
  const [timeframe, setTimeframe] = useState("5");
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [rsiMin, setRsiMin] = useState(55);
  const [rsiMax, setRsiMax] = useState(70);
  const [minAdx, setMinAdx] = useState(20);
  const [minRv, setMinRv] = useState(1.5);
  const [targetR, setTargetR] = useState(2);
  const [validated, setValidated] = useState(false);
  const bad = rsiMin > rsiMax;

  const labelIds = Object.keys(info.data?.labels ?? {});
  const groupable = labelIds.filter((id) => !ALWAYS.includes(id));
  const groupOf = (id: string) => groups.find((g) => g.members.includes(id));
  const modeOf = (id: string): Mode => modes[id] ?? (info.data?.config.conditions[id]?.mandatory ? "mandatory" : "optional");
  const conditions = Object.fromEntries(labelIds.map((id) => [id, { enabled: modeOf(id) !== "off", mandatory: modeOf(id) === "mandatory" }]));
  const flatMandatory = labelIds.some((id) => !groupOf(id) && !ALWAYS.includes(id) && modeOf(id) === "mandatory");
  const groupsOk = groups.every((g) => g.members.length > 0 && NAME_RE.test(g.id)) && new Set(groups.map((g) => g.id)).size === groups.length;
  const checks = [
    { label: "Name is set", ok: name.trim().length > 0 },
    { label: "RSI min is not above RSI max", ok: !bad },
    { label: "At least one mandatory entry condition or group", ok: flatMandatory || groups.length > 0 },
    { label: "Every group has a valid id and at least one condition", ok: groupsOk },
    { label: "Target is at least 0.5R", ok: targetR >= 0.5 },
  ];
  const valid = checks.every((c) => c.ok);

  const addGroup = () => {
    const n = groups.length + 1;
    setGroups([...groups, { id: `group-${n}`, op: "OR", members: [] }]);
  };
  const updateGroup = (idx: number, patch: Partial<Group>) => setGroups(groups.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  const toggleMember = (idx: number, id: string) => {
    const g = groups[idx];
    const members = g.members.includes(id) ? g.members.filter((m) => m !== id) : [...g.members, id];
    // a condition can only belong to one group: remove it from any other group first
    setGroups(groups.map((x, i) => (i === idx ? { ...x, members } : { ...x, members: x.members.filter((m) => m !== id) })));
  };

  const test = useMutation({
    mutationFn: () => api<{ results: ScanRow[] }>("/scanner/run", { method: "POST", body: { interval: timeframe, config: { conditions, groups, rsiMin, rsiMax, minAdx, minRelativeVolume: minRv, targetR } } }),
  });
  const backtest = useMutation({
    mutationFn: () => api<BacktestResult>("/backtests", { method: "POST", adminToken, body: { symbol: "RELIANCE", interval: timeframe, days: 40, config: { conditions, groups, rsiMin, rsiMax, minAdx, minRelativeVolume: minRv, targetR } } }),
  });
  const activate = useMutation({
    mutationFn: () => api("/strategies/active", { method: "PUT", adminToken, body: { conditions, groups, rsiMin, rsiMax, minAdx, minRelativeVolume: minRv } }),
  });
  const save = useMutation({
    mutationFn: () => api("/strategy-library", { method: "POST", adminToken, body: { name, overrides: { rsiMin, rsiMax, minAdx, minRelativeVolume: minRv, targetR } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)_18rem]">
      <Card title="Strategy details">
        <div className="grid gap-3 text-sm">
          <label>Strategy name<input className={`${input} mt-1 w-full`} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Stock universe<select className={`${input} mt-1 w-full`} disabled><option>{src.live ? "All NSE equities (live)" : "Sample list (5 stocks)"}</option></select></label>
          <label>Trading direction<select className={`${input} mt-1 w-full`} value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="bullish">Long (bullish)</option><option value="bearish" disabled>Short (not in this version)</option>
          </select></label>
          <label>Timeframe<select className={`${input} mt-1 w-full`} value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            <option value="1">1 min</option><option value="3">3 min</option><option value="5">5 min</option><option value="10">10 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 hour</option><option value="240">4 hour</option>
          </select></label>
          <label>Description<textarea className={`${input} mt-1 w-full`} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <p className="text-xs text-slate-500">Base logic: {info.data?.name ?? "EMA Momentum Pro"}. Groups combine with AND between them; inside a group you choose AND or OR.</p>
        </div>
      </Card>

      <div className="grid min-w-0 content-start gap-4">
        <Card title="Entry conditions">
          <ErrorBox error={info.error} />
          <ul className="divide-y divide-slate-800 text-sm">
            {labelIds.map((id) => {
              const label = info.data?.labels[id] ?? id;
              const g = groupOf(id);
              const always = ALWAYS.includes(id);
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span>{label}{always && <span className="ml-2 text-xs text-slate-500">always applies</span>}</span>
                  {always ? <Badge tone="slate">Mandatory</Badge> : g ? <Badge tone="amber">Group: {g.id}</Badge> : (
                    <span className="flex gap-1">
                      {MODES.map((m) => (
                        <button key={m} type="button" aria-pressed={modeOf(id) === m} onClick={() => setModes({ ...modes, [id]: m })}
                          className={`rounded px-2 py-0.5 text-xs capitalize ${modeOf(id) === m ? "bg-sky-700 text-white" : "bg-slate-800 text-slate-400"}`}>{m}</button>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Condition groups (AND / OR)" actions={<button className={btn} onClick={addGroup} disabled={groups.length >= 5}>Add group</button>}>
          {!groups.length && <p className="text-sm text-slate-500">No groups. Add one to combine conditions with AND or OR. Grouped conditions are judged by their group, not by Mandatory/Optional.</p>}
          <div className="grid gap-3">
            {groups.map((g, idx) => (
              <div key={idx} className="rounded-lg border border-slate-800 p-3 text-sm">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <input className={`${input} w-40`} aria-label="Group id" value={g.id} onChange={(e) => updateGroup(idx, { id: e.target.value.toLowerCase() })} />
                  <select className={input} aria-label="Group logic" value={g.op} onChange={(e) => updateGroup(idx, { op: e.target.value as Group["op"] })}>
                    <option value="OR">OR: any member passes</option><option value="AND">AND: all members pass</option>
                  </select>
                  <button className="text-xs text-red-300 underline" onClick={() => setGroups(groups.filter((_, i) => i !== idx))}>Remove</button>
                </div>
                {!NAME_RE.test(g.id) && <p className="mb-2 text-xs text-red-300">Id: use a-z, 0-9, hyphen (max 30).</p>}
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {groupable.map((id) => {
                    const owner = groupOf(id);
                    const inThis = g.members.includes(id);
                    return (
                      <label key={id} className={`flex items-center gap-2 ${owner && !inThis ? "text-slate-600" : ""}`}>
                        <input type="checkbox" checked={inThis} disabled={!!owner && !inThis} onChange={() => toggleMember(idx, id)} />
                        {info.data?.labels[id] ?? id}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-slate-500">{g.members.length} condition(s): {g.op === "AND" ? "all must pass" : "at least one must pass"}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Exit conditions">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
            {EXITS.map((e) => <li key={e}>{e}</li>)}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Trailing stop is off (0 ATR). Session exit applies to intraday strategies only.</p>
        </Card>

        <Card title="Thresholds">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label>RSI min<input className={`${input} mt-1 w-full`} type="number" value={rsiMin} onChange={(e) => setRsiMin(Number(e.target.value))} /></label>
            <label>RSI max<input className={`${input} mt-1 w-full`} type="number" value={rsiMax} onChange={(e) => setRsiMax(Number(e.target.value))} /></label>
            <label>Min ADX<input className={`${input} mt-1 w-full`} type="number" value={minAdx} onChange={(e) => setMinAdx(Number(e.target.value))} /></label>
            <label>Min rel. volume<input className={`${input} mt-1 w-full`} type="number" step="0.1" value={minRv} onChange={(e) => setMinRv(Number(e.target.value))} /></label>
          </div>
          {bad && <p className="mt-2 text-sm text-red-300">RSI min must not exceed RSI max.</p>}
        </Card>

        <Card title="Strategy summary">
          <p className="text-sm text-slate-300">{name || "Unnamed"} · long · {timeframe} min · {Object.values(conditions).filter((c) => c.enabled).length} conditions enabled · {groups.length} group(s) · target {targetR}R</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={btn} onClick={() => setValidated(true)}>Validate strategy</button>
            <button className={btn} onClick={() => test.mutate()} disabled={bad || !groupsOk || test.isPending}>{test.isPending ? "Testing…" : "Test on scanner"}</button>
            <button className={btn} onClick={() => backtest.mutate()} disabled={!adminToken || bad || !groupsOk || backtest.isPending}>{backtest.isPending ? "Running…" : "Backtest these rules"}</button>
            <button className={btn} onClick={() => activate.mutate()} disabled={!adminToken || !valid || !groupsOk || activate.isPending}>{activate.isPending ? "Setting…" : "Set as active strategy"}</button>
            <Link to="/backtest" className={btn}>Open Backtesting</Link>
            <button className={btn} onClick={() => save.mutate()} disabled={!adminToken || !valid || save.isPending}>Save preset</button>
          </div>
          {validated && (
            <ul className="mt-3 space-y-1 text-sm">
              {checks.map((c) => <li key={c.label} className={c.ok ? "text-emerald-300" : "text-red-300"}>{c.ok ? "✓" : "✗"} {c.label}</li>)}
            </ul>
          )}
          {!adminToken && <p className="mt-2 text-xs text-amber-300">Enter the admin token on the Connection page to save.</p>}
          {save.isSuccess && <p className="mt-2 text-xs text-emerald-400">Preset saved.</p>}
          {activate.isSuccess && <p className="mt-2 text-xs text-emerald-400">Active. The chart, watchlists, scanner and backtests now use these rules.</p>}
          {backtest.data && (
            <p className="mt-2 text-sm text-slate-300">Backtest on RELIANCE ({timeframe} min, 40 sessions): {backtest.data.metrics.trades} trades · win rate {fmtPct(backtest.data.metrics.winRate)} · net P&amp;L {fmtMoney(backtest.data.metrics.netProfit)}. SAMPLE data.</p>
          )}
          <ErrorBox error={test.error ?? save.error ?? backtest.error ?? activate.error} />
        </Card>
      </div>

      <div className="grid content-start gap-4">
        <Card title="Risk settings">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-slate-400">Stop-loss</dt><dd>ATR or swing low</dd>
            <dt className="text-slate-400">Target (R)</dt><dd><input className={`${input} w-20`} type="number" step="0.1" value={targetR} onChange={(e) => setTargetR(Number(e.target.value))} aria-label="Target R" /></dd>
            <dt className="text-slate-400">Risk per trade</dt><dd>0.5% of capital</dd>
            <dt className="text-slate-400">Position sizing</dt><dd>Risk amount ÷ stop distance, capped at 25% of capital</dd>
            <dt className="text-slate-400">Max positions</dt><dd>5</dd>
            <dt className="text-slate-400">Trading session</dt><dd>NSE 09:15–15:30 IST</dd>
          </dl>
          <p className="mt-3 text-xs text-slate-500">Risk defaults are set in the backend and shown here. Only target (R) can be changed.</p>
        </Card>
        <Card title="Test results">
          {!test.data ? <p className="text-sm text-slate-500">Run a test to see signals.</p> : (
            <ul className="space-y-1 text-sm">
              {test.data.results.map((r) => <li key={r.symbol} className="flex justify-between"><span>{r.symbol}</span><Badge tone={r.signal === "BUY" ? "green" : "slate"}>{r.signal}</Badge></li>)}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">{src.word} data. A BUY is a rule match, not a forecast.</p>
        </Card>
      </div>
    </div>
  );
}
