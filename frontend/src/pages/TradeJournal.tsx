import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst, fmtMoney, REASON_LABELS } from "../lib/format";
import type { JournalItem } from "../types";
import { Card, Empty, ErrorBox, input, btn } from "../components/Card";
import { Pager, usePager } from "../components/Pager";

export function TradeJournal() {
  const qc = useQueryClient();
  const adminToken = useAdmin((s) => s.adminToken);
  const q = useQuery({ queryKey: ["journal"], queryFn: () => api<{ items: JournalItem[]; note: string }>("/journal") });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (v: { key: string; note: string }) => api("/journal/note", { method: "PUT", adminToken, body: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journal"] }),
  });

  const pg = usePager(q.data?.items ?? []);
  return (
    <Card title="Trade journal · paper trades · times in IST">
      <ErrorBox error={q.error ?? save.error} />
      {!adminToken && <p className="mb-2 text-sm text-amber-300">Enter the admin token on the Connection page to save notes.</p>}
      {q.data && !q.data.items.length && <Empty>No paper trades yet. Run a scan on the Paper Trading page.</Empty>}
      {q.data && q.data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Entered</th><th>Exited</th><th>Symbol</th><th>Strategy and entry reason</th><th>Entry → Exit</th><th>Exit reason</th><th>Net P&amp;L</th><th>Note</th></tr></thead>
            <tbody>
              {pg.slice.map((t) => (
                <tr key={t.key} className="border-t border-slate-800 align-top">
                  <td className="py-1.5 whitespace-nowrap">{fmtIst(t.entryTime)}</td>
                  <td className="whitespace-nowrap">{fmtIst(t.exitTime)}</td>
                  <td>{t.symbol}</td>
                  <td className="max-w-[18rem] text-xs"><div className="text-slate-200">{t.strategy ?? "—"}</div><div className="text-slate-500">{t.entryReason ?? ""}</div></td>
                  <td className="whitespace-nowrap">{fmtMoney(t.entry)} → {fmtMoney(t.exit)} × {t.qty}</td>
                  <td>{REASON_LABELS[t.reason] ?? t.reason}</td>
                  <td className={t.netPnl >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtMoney(t.netPnl)}</td>
                  <td className="min-w-[16rem]">
                    <div className="flex gap-2">
                      <input className={`${input} flex-1`} maxLength={500} placeholder={t.note || "Add a note"} value={drafts[t.key] ?? ""} onChange={(e) => setDrafts({ ...drafts, [t.key]: e.target.value })} aria-label={`Note for ${t.symbol}`} />
                      <button className={btn} disabled={!adminToken || !(drafts[t.key] ?? "").trim() || save.isPending} onClick={() => { save.mutate({ key: t.key, note: drafts[t.key] }); setDrafts({ ...drafts, [t.key]: "" }); }}>Save</button>
                    </div>
                    {t.noteAt && <div className="mt-1 text-xs text-slate-500">Noted {fmtIst(t.noteAt)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager {...pg} />
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">{q.data?.note}</p>
    </Card>
  );
}
