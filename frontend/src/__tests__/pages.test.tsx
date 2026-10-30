import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Risk } from "../pages/Risk";
import { Audit } from "../pages/Audit";
import { Watchlists } from "../pages/Watchlists";

afterEach(() => vi.unstubAllGlobals());

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
};

describe("new pages", () => {
  it("risk page shows the daily loss limit in rupees", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      limits: { capital: 100000, maxOpenPositions: 5, maxDailyLossPct: 2, maxTradesPerDay: 10, maxOrderValuePct: 25, maxExposurePerStockPct: 25 },
      current: { openPositions: 1, dailyRealizedPnl: 0, emergencyStop: false },
    }), { status: 200 })));
    wrap(<Risk />);
    expect(await screen.findByText(/2% of capital/)).toBeInTheDocument();
  });

  it("audit page asks for the admin token and does not call the API without it", () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    wrap(<Audit />);
    expect(screen.getByText(/Enter the admin token/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("watchlist editor disables saving without the admin token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 })));
    wrap(<Watchlists />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("analysis and safety pages", () => {
  it("live trading page never shows an order button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false, implemented: false, gates: [{ id: "x", label: "Gate", ok: false }], note: "" }), { status: 200 })));
    const { LiveTrading } = await import("../pages/LiveTrading");
    wrap(<LiveTrading />);
    expect(await screen.findByText(/Live trading is disabled/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("builder and journal pages", () => {
  it("scanner builder blocks a run when RSI min is above RSI max", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ labels: {}, config: { conditions: {} } }), { status: 200 })));
    const { ScannerBuilder } = await import("../pages/ScannerBuilder");
    wrap(<ScannerBuilder />);
    const rsiMin = screen.getByLabelText("RSI min") as HTMLInputElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(rsiMin, { target: { value: "90" } });
    expect(await screen.findByText(/must not exceed RSI max/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("journal note save is disabled without the admin token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ key: "TCS:1", symbol: "TCS", qty: 1, entry: 1, exit: 2, entryTime: 0, exitTime: 1, reason: "TARGET", netPnl: 1, costs: 0, note: "" }], note: "" }), { status: 200 })));
    const { TradeJournal } = await import("../pages/TradeJournal");
    wrap(<TradeJournal />);
    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("library, lab and alerts pages", () => {
  it("lab run is disabled above nine combinations", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { StrategyLab } = await import("../pages/StrategyLab");
    const { fireEvent } = await import("@testing-library/react");
    wrap(<StrategyLab />);
    fireEvent.change(screen.getByDisplayValue("1.5, 2"), { target: { value: "1, 2, 3" } });
    fireEvent.change(screen.getByDisplayValue("1, 1.5"), { target: { value: "1, 1.5, 2, 2.5" } });
    expect(await screen.findByText("At most 9 combinations.")).toBeInTheDocument();
  });

  it("alerts page lets you view rules but not change them without the admin token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], note: "", }), { status: 200 })));
    const { Alerts } = await import("../pages/Alerts");
    wrap(<Alerts />);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
  });
});

describe("Kite data panel", () => {
  it("fetching Kite candles is disabled without the admin token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ defaultSource: "SAMPLE", kiteSessionActive: false, kiteInstruments: 0, instrumentsLoadedAt: null, note: "" }), { status: 200 })));
    const { KiteDataPanel } = await import("../pages/KiteDataPanel");
    wrap(<KiteDataPanel />);
    expect(await screen.findByRole("button", { name: "Fetch Kite candles" })).toBeDisabled();
    expect(screen.getByText(/UNVERIFIED/)).toBeInTheDocument();
  });
});

describe("analyst page", () => {
  it("labels the summary as not AI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 })));
    const { Analyst } = await import("../pages/Analyst");
    wrap(<Analyst />);
    expect(screen.getByText("Not AI")).toBeInTheDocument();
  });
});
