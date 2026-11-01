import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("app shell", () => {
  it("always shows the paper-only and SAMPLE labels", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    vi.stubGlobal("WebSocket", class { onopen = null; onmessage = null; onclose = null; close() {} constructor() {} } as unknown as typeof WebSocket);
    renderAt("/");
    expect(screen.getByText("PAPER ONLY")).toBeInTheDocument();
    expect(screen.getByText("SAMPLE DATA")).toBeInTheDocument();
    expect(screen.getByText(/No real orders are placed/)).toBeInTheDocument();
  });

  it("backtest page asks for the admin token before running", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 })));
    vi.stubGlobal("WebSocket", class { onopen = null; onmessage = null; onclose = null; close() {} constructor() {} } as unknown as typeof WebSocket);
    renderAt("/backtest");
    expect(screen.getByText(/Enter the admin token/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run backtest" })).toBeDisabled();
  });
});
