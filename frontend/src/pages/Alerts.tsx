import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst } from "../lib/format";
import type { AlertRuleView, Instrument, NotificationView } from "../types";
import { btn, Card, Empty, ErrorBox, input } from "../components/Card";

export function Alerts() {
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const rules = useQuery({ queryKey: ["alerts"], queryFn: () => api<{ items: AlertRuleView[]; note: string }>("/alerts") });
  const notes = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: NotificationView[]; note: string }>("/notifications"), refetchInterval: 30_000 });
  const [symbol, setSymbol] = useState("INFY");
  const [type, setType] = useState<"PRICE_ABOVE" | "PRICE_BELOW" | "SIGNAL_BUY">("PRICE_ABOVE");
  const [value, setValue] = useState(1500);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["alerts"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); };
  const add = useMutation({ mutationFn: () => api("/alerts", { method: "POST", adminToken, body: type === "SIGNAL_BUY" ? { symbol, type } : { symbol, type, value } }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api(`/alerts/${id}`, { method: "DELETE", adminToken }), onSuccess: refresh });
  const check = useMutation({ mutationFn: () => api<{ fired: string[]; checked: number }>("/alerts/check", { method: "POST", adminToken }), onSuccess: refresh });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Alert rules" actions={<button className={btn} onClick={() => check.mutate()} disabled={!adminToken || check.isPending}>Check now</button>}>
        <ErrorBox error={rules.error ?? check.error ?? del.error} />
        {!rules.data?.items.length ? <Empty>No alert rules.</Empty> : (
          <ul className="space-y-2 text-sm">
            {rules.data.items.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded border border-slate-800 p-2">
                <span>{r.symbol} · {r.type === "SIGNAL_BUY" ? "scanner BUY" : `${r.type === "PRICE_ABOVE" ? "close above" : "close below"} ${r.value}`}</span>
                <button className="text-red-400 underline disabled:opacity-50" disabled={!adminToken} onClick={() => del.mutate(r.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
        {rules.data && <p className="mt-3 text-xs text-slate-500">{rules.data.note}</p>}
      </Card>

      <Card title="New rule" actions={<button className={btn} onClick={() => add.mutate()} disabled={!adminToken || add.isPending}>Add</button>}>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>Symbol<select className={`${input} mt-1 w-full`} value={symbol} onChange={(e) => setSymbol(e.target.value)}>{(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}</select></label>
          <label>Type<select className={`${input} mt-1 w-full`} value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="PRICE_ABOVE">Close above</option><option value="PRICE_BELOW">Close below</option><option value="SIGNAL_BUY">Scanner BUY</option></select></label>
          {type !== "SIGNAL_BUY" && <label className="col-span-2">Price<input className={`${input} mt-1 w-full`} type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} /></label>}
        </div>
        {!adminToken && <p className="mt-2 text-sm text-amber-300">Enter the admin token on the Connection page to add or check rules.</p>}
        <ErrorBox error={add.error} />
        <p className="mt-3 text-xs text-slate-500">Rules are only checked when you press Check now. Nothing is sent to email, SMS or a phone.</p>
      </Card>

      <Card title="Notifications (in app)">
        <ErrorBox error={notes.error} />
        {!notes.data?.items.length ? <Empty>No notifications yet.</Empty> : (
          <ul className="space-y-2 text-sm">
            {notes.data.items.map((n, i) => <li key={i} className="rounded border border-slate-800 p-2"><span className="text-xs text-slate-500">{fmtIst(new Date(n.at).getTime())}</span><div>{n.message}</div>{n.delivery && <div className="mt-1 text-xs text-slate-400">Delivery: {n.delivery === "DELIVERED" ? "sent to webhook" : n.delivery === "FAILED" ? `failed (${n.deliveryError ?? "error"})` : "no webhook configured. In-app only."}</div>}</li>)}
          </ul>
        )}
        {notes.data && <p className="mt-3 text-xs text-slate-500">{notes.data.note}</p>}
      </Card>
    </div>
  );
}
