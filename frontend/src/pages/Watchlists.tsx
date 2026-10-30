import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import type { Instrument, Watchlist } from "../types";
import { btn, Card, Empty, ErrorBox, input } from "../components/Card";

export function Watchlists() {
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const lists = useQuery({ queryKey: ["watchlists"], queryFn: () => api<{ items: Watchlist[] }>("/watchlists") });
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const [name, setName] = useState("default");
  const [picked, setPicked] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () => api(`/watchlists/${encodeURIComponent(name)}`, { method: "PUT", adminToken, body: { symbols: picked } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlists"] }),
  });

  const toggle = (sym: string) => setPicked((p) => (p.includes(sym) ? p.filter((s) => s !== sym) : [...p, sym]));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Saved watchlists">
        <ErrorBox error={lists.error} />
        {!lists.data?.items.length ? <Empty>No watchlists.</Empty> : (
          <ul className="space-y-2 text-sm">
            {lists.data.items.map((w) => (
              <li key={w.name} className="rounded border border-slate-800 p-2">
                <button className="font-medium text-sky-400 underline" onClick={() => { setName(w.name); setPicked(w.symbols); }}>{w.name}</button>
                <span className="ml-2 text-slate-400">{w.symbols.join(", ") || "empty"}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">Watchlists are kept in memory and reset on restart. Up to 20 lists.</p>
      </Card>

      <Card title="Edit watchlist" actions={<button className={btn} onClick={() => save.mutate()} disabled={!adminToken || !name || save.isPending}>Save</button>}>
        <input className={`${input} mb-3 w-full`} value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="name (a-z, 0-9, -)" aria-label="Watchlist name" />
        {!adminToken && <p className="mb-2 text-sm text-amber-300">Enter the admin token on the Connection page to save.</p>}
        <div className="grid grid-cols-2 gap-2 text-sm">
          {(instruments.data?.items ?? []).map((i) => (
            <label key={i.symbol} className="flex items-center gap-2">
              <input type="checkbox" checked={picked.includes(i.symbol)} onChange={() => toggle(i.symbol)} />
              {i.symbol} <span className="text-xs text-slate-500">{i.name}</span>
            </label>
          ))}
        </div>
        <div className="mt-3"><ErrorBox error={save.error} /></div>
        {save.isSuccess && <p className="mt-2 text-sm text-emerald-400">Saved.</p>}
      </Card>
    </div>
  );
}
