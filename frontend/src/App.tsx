import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Scanner } from "./pages/Scanner";
import { Strategy } from "./pages/Strategy";
import { Chart } from "./pages/Chart";
import { Backtest } from "./pages/Backtest";
import { PaperTrading } from "./pages/PaperTrading";
import { Connection } from "./pages/Connection";
import { Watchlists } from "./pages/Watchlists";
import { Risk } from "./pages/Risk";
import { Audit } from "./pages/Audit";
import { TechnicalAnalysis } from "./pages/TechnicalAnalysis";
import { MultiTimeframe } from "./pages/MultiTimeframe";
import { MarketDataMonitor } from "./pages/MarketDataMonitor";
import { LiveTrading } from "./pages/LiveTrading";
import { Portfolio } from "./pages/Portfolio";
import { MarketOverview } from "./pages/MarketOverview";
import { ScannerBuilder } from "./pages/ScannerBuilder";
import { TradeJournal } from "./pages/TradeJournal";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { StrategyLibrary } from "./pages/StrategyLibrary";
import { StrategyLab } from "./pages/StrategyLab";
import { Alerts } from "./pages/Alerts";
import { Analyst } from "./pages/Analyst";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="scanner" element={<Scanner />} />
        <Route path="strategy" element={<Strategy />} />
        <Route path="chart" element={<Chart />} />
        <Route path="backtest" element={<Backtest />} />
        <Route path="paper" element={<PaperTrading />} />
        <Route path="connection" element={<Connection />} />
        <Route path="watchlists" element={<Watchlists />} />
        <Route path="risk" element={<Risk />} />
        <Route path="audit" element={<Audit />} />
        <Route path="technical" element={<TechnicalAnalysis />} />
        <Route path="mtf" element={<MultiTimeframe />} />
        <Route path="data" element={<MarketDataMonitor />} />
        <Route path="live" element={<LiveTrading />} />
        <Route path="portfolio" element={<Portfolio />} />
        <Route path="overview" element={<MarketOverview />} />
        <Route path="builder" element={<ScannerBuilder />} />
        <Route path="journal" element={<TradeJournal />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="library" element={<StrategyLibrary />} />
        <Route path="lab" element={<StrategyLab />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="analyst" element={<Analyst />} />
        <Route path="*" element={<p className="text-slate-400">Page not found.</p>} />
      </Route>
    </Routes>
  );
}
