import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { usePushStatus } from "../lib/useLiveStatus";
import type { AppStatus, BrokerStatus, Instrument, QuotesResponse } from "../types";

type Item = [string, string];
const GROUPS: { title: string; items: Item[] }[] = [
  { title: "Dashboard", items: [["/", "Dashboard"]] },
  { title: "Market Data", items: [["/overview", "Market Overview"], ["/scanner", "Stock Scanner"], ["/chart", "Advanced Charts"], ["/technical", "Technical Analysis"], ["/mtf", "Multi-Timeframe"], ["/watchlists", "Watchlists"], ["/data", "Market Data Monitor"], ["/analyst", "Analyst (rule-based)"]] },
  { title: "Strategy Lab", items: [["/strategy", "Strategy Builder"], ["/builder", "Scanner Builder"], ["/library", "Strategy Library"], ["/backtest", "Backtesting"], ["/lab", "Strategy Lab"]] },
  { title: "Trading", items: [["/paper", "Paper Trading"], ["/live", "Live Trading"], ["/portfolio", "Portfolio & Risk"], ["/journal", "Trade Journal"], ["/alerts", "Alerts"]] },
  { title: "Management", items: [["/reports", "Reports & Analytics"], ["/risk", "Risk Settings"], ["/audit", "Audit Log"], ["/settings", "Settings"]] },
  { title: "System", items: [["/connection", "Settings & Zerodha"]] },
];
const TITLES = new Map<string, string>(GROUPS.flatMap((g) => g.items));

function NavGroup({ title, items }: { title: string; items: Item[] }) {
  return (
    <div className="mb-3">
      <div className="px-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500">{title}</div>
      {items.map(([to, label]) => (
        <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `block truncate rounded-md px-3 py-1.5 text-[13px] ${isActive ? "bg-sky-700 text-white" : "text-slate-300 hover:bg-slate-800"}`}>
          {label}
        </NavLink>
      ))}
    </div>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<{ items: Instrument[] }>("/instruments") });
  const submit = () => {
    const sym = value.trim().toUpperCase();
    if (sym) navigate(`/chart?symbol=${encodeURIComponent(sym)}`);
    setValue("");
  };
  return (
    <form className="w-56" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input list="stock-symbols" className="w-full rounded border border-slate-700 bg-[#0b1020] px-2 py-1 text-xs text-slate-200" placeholder="Search symbol" aria-label="Global stock search"
        value={value} onChange={(e) => setValue(e.target.value)} />
      <datalist id="stock-symbols">
        {(instruments.data?.items ?? []).map((i) => <option key={i.symbol} value={i.symbol} />)}
      </datalist>
    </form>
  );
}

function BrokerControl() {
  const broker = useQuery({ queryKey: ["broker"], queryFn: () => api<BrokerStatus>("/broker/status") });
  const login = useMutation({
    mutationFn: () => api<{ url: string }>("/broker/login-url"),
    onSuccess: (d) => { window.location.href = d.url; },
  });
  if (broker.data?.connected) {
    return <span className="rounded border border-emerald-700 bg-emerald-950/60 px-2 py-0.5 text-xs text-emerald-300">Kite connected</span>;
  }
  return (
    <button type="button" onClick={() => login.mutate()} disabled={!broker.data?.configured || login.isPending}
      className="rounded border border-sky-700 bg-sky-800 px-2.5 py-1 text-xs font-medium text-sky-50 hover:bg-sky-700 disabled:opacity-40"
      title={broker.data?.configured ? "Log in to Zerodha Kite" : "Kite is not configured on the server"}>
      {login.isPending ? "Opening Kite…" : "Login with Kite"}
    </button>
  );
}

export function Layout() {
  const location = useLocation();
  const push = usePushStatus();
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: () => api<QuotesResponse>("/market/quotes"), refetchInterval: 15_000 });
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<AppStatus>("/status"), refetchInterval: 30_000 });
  const isKite = quotes.data?.source === "KITE";
  const title = TITLES.get(location.pathname) ?? (location.pathname === "/" ? "Dashboard" : "StockPilot AI");
  return (
    <div className="flex min-h-screen bg-[#0b1020] text-slate-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-[#0d1426] px-3 py-4">
        <div className="mb-5 flex items-center gap-2 px-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-sky-600 text-xs font-bold">SP</span>
          <span className="font-semibold">StockPilot AI</span>
        </div>
        <nav aria-label="Main" className="flex flex-col overflow-y-auto">
          {GROUPS.map((g) => <NavGroup key={g.title} title={g.title} items={g.items} />)}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-[#0d1426] px-5 py-2.5">
          <h1 className="mr-auto text-base font-semibold text-slate-100">{title}</h1>
          <span className={`rounded border px-2 py-0.5 text-xs ${status.data?.marketOpen ? "border-emerald-700 text-emerald-300" : "border-slate-600 text-slate-400"}`}>
            Market {status.data?.marketOpen ? "open" : "closed"}
          </span>
          <GlobalSearch />
          <NavLink to="/alerts" className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800" aria-label="Notifications and alerts">Alerts</NavLink>
          <BrokerControl />
          <span className="rounded border border-amber-800 bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300">PAPER ONLY</span>
          <span className={`rounded border px-2 py-0.5 text-xs ${isKite ? "border-emerald-700 bg-emerald-950/60 text-emerald-300" : "border-slate-600 bg-slate-800 text-slate-300"}`}>
            {isKite ? "KITE LIVE" : "SAMPLE DATA"}
          </span>
          <span className={`text-xs ${push.connected ? "text-emerald-400" : "text-red-400"}`}>● {push.connected ? "Connected" : "Offline"}</span>
          <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-700 text-xs" aria-label="Profile">S</span>
        </header>
        <main className="flex-1 overflow-x-hidden p-5">
          {quotes.data?.fallbackReason && (
            <div className="mb-4 rounded-lg border border-amber-800 bg-amber-950/40 p-2.5 text-sm text-amber-200">{quotes.data.fallbackReason}</div>
          )}
          <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 text-xs text-slate-400">
            Research and paper trading only. No real orders are placed. {isKite ? "Market data is live from Kite." : "Market data is SAMPLE (generated) unless Kite is connected."}
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
