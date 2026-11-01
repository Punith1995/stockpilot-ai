import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst, fmtMoney } from "../lib/format";
import type { AlertRuleView, Instrument, NotificationView } from "../types";
import { Badge } from "../components/Badge";
import { Watchlists } from "./Watchlists";
import { btn, Card, Empty, ErrorBox, input, Tile } from "../components/Card";
import { useDataSource } from "../lib/source";

export function Alerts() {
  const [tab, setTab] = useState<"Alerts" | "Watchlists">("Alerts");
  return (
    <div className="grid gap-4">
      <div role="tablist" className="flex gap-1">
        {(["Alerts", "Watchlists"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>{t}</button>
        ))}
      </div>
      {tab === "Alerts" ? <AlertsTab /> : <Watchlists />}
    </div>
  );
}

const TYPE_LABEL: Record<AlertRuleView["type"], string> = { PRICE_ABOVE: "Close above", PRICE_BELOW: "Close below", SIGNAL_BUY: "Scanner BUY" };

/** Price and scanner alerts. Checks run only when you press Check now. Nothing is sent unless a webhook is configured. */
function AlertsTab() {
  const src = useDataSource();
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const rules = useQuery({ queryKey: ["alerts"], queryFn: () => api<{ items: AlertRuleView[]; note: string }>("/alerts"), refetchInterval: 30_000 });
  const notes = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: NotificationView[]; note: string }>("/notifications"), refetchInterval: 30_000 });
  const [symbol, setSymbol] = useState("INFY");
  const [type, setType] = useState<AlertRuleView["type"]>("PRICE_ABOVE");
  const [value, setValue] = useState(1500);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<number>(0);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["alerts"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); };
  const add = useMutation({ mutationFn: () => api("/alerts", { method: "POST", adminToken, body: type === "SIGNAL_BUY" ? { symbol, type } : { symbol, type, value } }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api(`/alerts/${id}`, { method: "DELETE", adminToken }), onSuccess: refresh });
  const update = useMutation({ mutationFn: (v: { id: string; body: { enabled?: boolean; value?: number } }) => api(`/alerts/${v.id}`, { method: "PUT", adminToken, body: v.body }), onSuccess: () => { setEditing(null); refresh(); } });
  const check = useMutation({ mutationFn: () => api<{ fired: string[] }>("/alerts/check", { method: "POST", adminToken }), onSuccess: refresh });

  const items = rules.data?.items ?? [];
  const total = items.length;
  const disabled = items.filter((r) => !r.enabled).length;
  const active = total - disabled;
  const triggered = items.filter((r) => r.triggeredAt).length;
  const status = (r: AlertRuleView) => (!r.enabled ? { text: "Disabled", tone: "slate" as const } : r.triggeredAt ? { text: "Triggered", tone: "green" as const } : { text: "Active", tone: "amber" as const });

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Total alerts" value={total} />
        <Tile label="Active alerts" value={active} />
        <Tile label="Triggered alerts" value={triggered} tone="text-emerald-300" />
        <Tile label="Disabled alerts" value={disabled} tone="text-slate-400" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
        <Card title="Create alert">
          <div className="grid gap-3 text-sm">
            <label>Stock symbol<select className={`${input} mt-1 w-full`} value={symbol} onChange={(e) => setSymbol(e.target.value)}>{(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}</select></label>
            <label>Alert type<select className={`${input} mt-1 w-full`} value={type} onChange={(e) => setType(e.target.value as AlertRuleView["type"])}>
              <option value="PRICE_ABOVE">Price: close above</option><option value="PRICE_BELOW">Price: close below</option><option value="SIGNAL_BUY">Indicator: scanner BUY (EMA Momentum Pro)</option>
            </select></label>
            {type !== "SIGNAL_BUY" && <label>Target price (₹)<input className={`${input} mt-1 w-full`} type="number" min={1} value={value} onChange={(e) => setValue(Number(e.target.value))} /></label>}
            <p className="text-xs text-slate-400">Timeframe: daily close for price alerts, latest 1-minute bar for scanner alerts ({src.word} data).</p>
            <p className="text-xs text-slate-400">Notification: in-app list below{rules.data?.note ? "" : ""}. Webhook delivery only if the server has one set.</p>
            <button className={btn} onClick={() => add.mutate()} disabled={!adminToken || add.isPending}>Create alert</button>
            {!adminToken && <p className="text-xs text-amber-300">Enter the admin token on the Connection page to create, edit or check alerts.</p>}
            <ErrorBox error={add.error} />
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Alerts" actions={<button className={btn} onClick={() => check.mutate()} disabled={!adminToken || check.isPending}>{check.isPending ? "Checking…" : "Check now"}</button>}>
            <ErrorBox error={rules.error ?? check.error ?? del.error ?? update.error} />
            {!items.length ? <Empty>No alerts yet. Create one on the left.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Stock</th><th>Condition</th><th>Current value</th><th>Target value</th><th>Status</th><th>Triggered</th><th></th></tr></thead>
                  <tbody>
                    {items.map((r) => {
                      const st = status(r);
                      return (
                        <tr key={r.id} className="border-t border-slate-800">
                          <td className="py-1.5 font-medium">{r.symbol}</td>
                          <td>{TYPE_LABEL[r.type]}</td>
                          <td>{r.currentValue == null ? "—" : fmtMoney(r.currentValue)}</td>
                          <td>
                            {r.type === "SIGNAL_BUY" ? "—" : editing === r.id ? (
                              <input className={`${input} w-28`} type="number" min={1} value={draft} onChange={(e) => setDraft(Number(e.target.value))} aria-label="New target" />
                            ) : fmtMoney(r.value ?? null)}
                          </td>
                          <td><Badge tone={st.tone}>{st.text}</Badge></td>
                          <td className="whitespace-nowrap text-slate-400">{r.triggeredAt ? fmtIst(new Date(r.triggeredAt).getTime()) : "—"}</td>
                          <td className="whitespace-nowrap">
                            <div className="flex flex-wrap justify-end gap-2">
                              {editing === r.id ? (
                                <button className={btn} onClick={() => update.mutate({ id: r.id, body: { value: draft } })} disabled={!adminToken || !(draft > 0)}>Save</button>
                              ) : r.type !== "SIGNAL_BUY" && (
                                <button className="text-sky-400 underline disabled:opacity-50" disabled={!adminToken} onClick={() => { setEditing(r.id); setDraft(r.value ?? 0); }}>Edit</button>
                              )}
                              <button className="text-slate-300 underline disabled:opacity-50" disabled={!adminToken || update.isPending} onClick={() => update.mutate({ id: r.id, body: { enabled: !r.enabled } })}>{r.enabled ? "Disable" : "Enable"}</button>
                              <button className="text-red-400 underline disabled:opacity-50" disabled={!adminToken} onClick={() => del.mutate(r.id)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">{rules.data?.note}</p>
          </Card>

          <Card title="Notifications">
            <ErrorBox error={notes.error} />
            {!notes.data?.items.length ? <Empty>No notifications yet. Press Check now to test your alerts.</Empty> : (
              <ul className="space-y-2 text-sm">
                {notes.data.items.map((n, i) => (
                  <li key={i} className="rounded border border-slate-800 p-2">
                    <span className="text-xs text-slate-500">{fmtIst(new Date(n.at).getTime())}</span>
                    <div>{n.message}</div>
                    {n.delivery && <div className="mt-1 text-xs text-slate-400">Delivery: {n.delivery === "DELIVERED" ? "sent to webhook" : n.delivery === "FAILED" ? `failed (${n.deliveryError ?? "error"})` : "in-app only (no webhook set)"}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
