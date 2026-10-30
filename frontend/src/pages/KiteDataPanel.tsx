import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAdmin } from "../lib/store";
import { fmtIst } from "../lib/format";
import type { Instrument, KiteDataSource } from "../types";
import { Badge } from "../components/Badge";
import { btn, Card, ErrorBox, input } from "../components/Card";

/** Opt-in Kite historical fetch. Unverified against the live service. Admin token and Kite login needed. */
export function KiteDataPanel() {
  const adminToken = useAdmin((s) => s.adminToken);
  const source = useQuery({ queryKey: ["data-source"], queryFn: () => api<KiteDataSource>("/data/source") });
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const [symbol, setSymbol] = useState("RELIANCE");
  const [interval, setInterval] = useState("5");
  const [days, setDays] = useState(20);
  const load = useMutation({
    mutationFn: () => api<{ loaded: number }>("/data/kite/instruments", { method: "POST", adminToken }),
    onSuccess: () => source.refetch(),
  });
  const fetchC = useMutation({
    mutationFn: () => api<{ count: number; requests: number; skippedRows: number; candles: { time: number }[] }>(`/data/kite/candles/${symbol}?interval=${interval}&days=${days}`, { adminToken }),
  });
  const dataKite = source.data?.kiteInstruments ?? 0;

  return (
    <Card title="Kite historical data · opt-in · UNVERIFIED" actions={<Badge tone="amber">Not used by charts or scans</Badge>}>
      <p className="mb-3 text-sm text-slate-400">
        Fetches real NSE history through your Kite session. The endpoints have not been checked against the live service, so the first call may fail or return a different format. Charts and scans keep using SAMPLE data.
      </p>
      <ErrorBox error={source.error ?? load.error ?? fetchC.error} />
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <button className={btn} onClick={() => load.mutate()} disabled={!adminToken || load.isPending}>Load NSE instrument list</button>
        <span className="text-slate-400">{dataKite ? `${dataKite} instruments loaded${source.data?.instrumentsLoadedAt ? ` (${fmtIst(new Date(source.data.instrumentsLoadedAt).getTime())})` : ""}` : "None loaded"}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <label>Symbol<br />
          <select className={input} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {(instruments.data?.items ?? []).map((i) => <option key={i.symbol}>{i.symbol}</option>)}
          </select>
        </label>
        <label>Interval<br />
          <select className={input} value={interval} onChange={(e) => setInterval(e.target.value)}>
            <option value="1">1 min</option><option value="5">5 min</option><option value="15">15 min</option><option value="60">60 min</option><option value="D">Daily</option>
          </select>
        </label>
        <label>Days<br /><input className={input} type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
        <button className={btn} onClick={() => fetchC.mutate()} disabled={!adminToken || !dataKite || fetchC.isPending}>Fetch Kite candles</button>
      </div>
      {!adminToken && <p className="mt-2 text-sm text-amber-300">Enter the admin token on the Connection page, and log in to Kite there first.</p>}
      {fetchC.data && (
        <p className="mt-3 text-sm text-slate-300">
          Received {fetchC.data.count} candles in {fetchC.data.requests} request(s). Skipped {fetchC.data.skippedRows} malformed rows. Source: KITE (unverified).
        </p>
      )}
    </Card>
  );
}
