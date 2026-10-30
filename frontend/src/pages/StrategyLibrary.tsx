import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst } from "../lib/format";
import type { LibraryPreset } from "../types";
import { btn, Card, Empty, ErrorBox, input } from "../components/Card";

export function StrategyLibrary() {
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
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Strategies">
        <ErrorBox error={q.error} />
        {q.data && (
          <ul className="space-y-2 text-sm">
            <li className="rounded border border-slate-800 p-2"><span className="font-medium">{q.data.builtIn.name}</span></li>
            {q.data.saved.map((p) => (
              <li key={p.id} className="rounded border border-slate-800 p-2">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-slate-400">{Object.entries(p.overrides).map(([k, v]) => `${k}=${v}`).join(" · ") || "no overrides"} · saved {fmtIst(new Date(p.createdAt).getTime())}</div>
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
  );
}
