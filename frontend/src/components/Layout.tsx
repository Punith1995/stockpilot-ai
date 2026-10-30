import { NavLink, Outlet } from "react-router-dom";
import { usePushStatus } from "../lib/useLiveStatus";
import { Badge } from "./Badge";

const NAV = [
  ["/", "Dashboard"], ["/scanner", "Scanner"], ["/strategy", "Strategy"], ["/chart", "Chart"],
  ["/backtest", "Backtest"], ["/paper", "Paper Trading"], ["/watchlists", "Watchlists"], ["/risk", "Risk"], ["/audit", "Audit"], ["/technical", "Technical"], ["/mtf", "Multi-TF"], ["/data", "Data Monitor"], ["/portfolio", "Portfolio"], ["/live", "Live Trading"], ["/overview", "Overview"], ["/builder", "Scanner Builder"], ["/journal", "Journal"], ["/reports", "Reports"], ["/settings", "Settings"], ["/library", "Library"], ["/lab", "Strategy Lab"], ["/alerts", "Alerts"], ["/analyst", "Analyst"], ["/connection", "Connection"],
] as const;

export function Layout() {
  const push = usePushStatus();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-900/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-lg font-semibold">StockPilot AI</span>
          <Badge tone="amber">PAPER ONLY</Badge>
          <Badge tone="slate">Data: SAMPLE</Badge>
          <Badge tone={push.connected ? "green" : "red"}>{push.connected ? "Push connected" : "Push offline"}</Badge>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `whitespace-nowrap rounded px-3 py-1.5 text-sm ${isActive ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4 rounded border border-amber-700/50 bg-amber-950/40 p-3 text-sm text-amber-200">
          Research and paper trading only. No real orders are placed. Market data shown is SAMPLE (generated), not NSE data.
        </div>
        <Outlet />
      </main>
    </div>
  );
}
