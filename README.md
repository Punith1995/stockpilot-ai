# StockPilot AI

A research and paper-trading platform for NSE stocks, with a TypeScript backend and a React frontend.

**Paper trading only.** No real orders can be placed. All market data is SAMPLE (generated), not NSE data. Read "Limitations" before using it.

## Layout
```
backend/    Express + TypeScript API, WebSocket, strategy, risk gate, backtester, paper engine, Kite login code
frontend/   React + Vite + Tailwind app with 24 pages
render.yaml Render Blueprint: backend web service + frontend static site
.env.example
```

## Pages (frontend)
| Page | What it does |
|---|---|
| Dashboard | System status, paper account summary, push-channel status |
| Scanner | Runs EMA Momentum Pro over the sample instruments |
| Strategy | Read-only view of the strategy parameters and condition flags |
| Chart | Candlestick chart (1/5/15 min) of SAMPLE bars, shown in IST |
| Backtest | Runs a single-symbol backtest; shows metrics, warnings, trades |
| Paper Trading | Paper account, orders, positions, closed trades; scan and emergency stop |
| Connection | Admin token (memory only), Kite login URL and session exchange |
| Watchlists | Create and edit up to 20 in-memory watchlists (admin) |
| Risk | Read-only view of the paper risk limits and current state |
| Audit | Admin action log; never records tokens or request bodies (admin) |
| Technical | Latest indicator values (EMA, RSI, MACD, ADX, ATR, VWAP, Bollinger) for a symbol |
| Multi-TF | Trend bias on 1, 5 and 15 minute bars and whether they agree |
| Data Monitor | Candle quality per symbol: dropped rows, duplicates, strategy readiness |
| Live Trading | Safety gates only. No order button exists |
| Portfolio | Paper equity, cash and positions at entry price |
| Overview | Market overview of the sample instruments: last price, change, volume |
| Scanner Builder | Set each condition to mandatory, optional or off, and tune thresholds; then run the scan |
| Journal | Paper trades with notes (admin to save; in memory) |
| Reports | Backtest history with CSV export of trades |
| Settings | Read-only view of app, strategy defaults and risk limits; no secrets shown |
| Library | Built-in strategy plus saved parameter presets (admin to save; in memory) |
| Strategy Lab | Grid sweep of up to 9 combinations, ranked by out-of-sample result, with an overfitting warning (admin) |
| Alerts | Price and scanner-BUY rules, checked on demand; in-app notifications and optional webhook (admin to change) |
| Analyst | Rule-based plain-English summary of trend, RSI and scanner state. Labelled "Not AI" |

All 24 spec pages now exist in some form. The AI Market Analyst is rule-based, not an AI model. Alerts can go to a webhook only: there is no email, SMS or push delivery. Settings is read-only. Also not built: the live Kite historical data loader.

## Backend features
- Config validation; production refuses to start without `ADMIN_TOKEN`, `ENCRYPTION_KEY`, `CORS_ORIGINS`, `FRONTEND_URL`
- Indicators: SMA, EMA, RSI (Wilder), MACD, ATR, ADX, Bollinger, VWAP (resets per IST day), crossovers
- Candle sanitising, NSE session filter (09:15–15:30 IST, Mon–Fri), aggregation to 5/15 min
- Strategy EMA Momentum Pro with per-condition enable/mandatory flags
- Pre-trade risk gate: positions, daily loss, trades per day, order size, per-stock exposure, emergency stop
- Backtester: next-open fills, slippage, stop-first intrabar rule, costs model, metrics with stated definitions, optional out-of-sample split by IST session (stability check only)
- Audit log of admin actions (bounded, in memory) and a risk-limits endpoint
- Paper engine (in memory): pending → filled orders, duplicate-signal protection, emergency flatten
- Kite login, session exchange (token encrypted in memory), status, logout
- Kite historical loader (opt-in, UNVERIFIED): NSE equity instrument list and chunked historical candles. Charts and scans stay on SAMPLE unless you call the Kite endpoints.
- Alert delivery by webhook (optional `ALERT_WEBHOOK_URL`, https required in production). Each notification records DELIVERED, FAILED or NOT_CONFIGURED.
- Admin endpoints require `X-Admin-Token`; they return 503 when `ADMIN_TOKEN` is not set
- Rate limiting, helmet, JSON-only errors without stack traces
- WebSocket `/ws`: origin check, heartbeat, backpressure, paper status every 5 s

## Tests
- Backend: 92 tests (`cd backend && npm test`) covering indicators, candles, costs, strategy look-ahead, risk gate, backtest and metrics, API security (admin guard, live-trading 403, validation), and paper-trading safety
- Frontend: 18 tests (`cd frontend && npm test`) covering formatting, API client errors and token handling, app shell, and the Risk, Audit, Watchlist, Live Trading, Scanner Builder, Journal, Lab and Alerts pages
- Typecheck and build for both (`npm run typecheck`, `npm run build`)

## Run locally
```bash
cp .env.example backend/.env         # fill ADMIN_TOKEN (16+ chars) and ENCRYPTION_KEY (32+ chars)
cd backend && npm install && npm run dev
# another terminal
cd frontend && npm install && npm run dev   # http://localhost:5173, proxies /api to :5000
```

## Deploy on Render (free)
1. Push this folder to a GitHub repo.
2. In Render, create a Blueprint from `render.yaml`. It creates two services.
3. Backend env vars: `CORS_ORIGINS` and `FRONTEND_URL` (the frontend's exact origin), `ADMIN_TOKEN`, `ENCRYPTION_KEY`, and optionally the Kite values.
4. Frontend env var: `VITE_API_URL` = the backend URL. Set it before the first build.
5. Optional: `ALERT_WEBHOOK_URL` on the backend to receive alerts at an https endpoint you control.

## Limitations
- **No real market data.** Backtests and scans use SAMPLE data. Results say nothing about real NSE performance.
- **Kite historical data is unverified.** The endpoints, auth header, instrument CSV and candle format were written from memory of the public docs. The first real call may fail. Pure parsing is tested with fixtures; network calls are not.
- **Analyst is not AI.** It turns indicator values into fixed sentences. It cannot reason about news, fundamentals or anything outside the indicators.
- **Webhook is the only alert channel.** Email, SMS and push are not implemented.
- **No live trading.** `POST /api/v1/live/orders` returns 403 by design.
- **No database.** Watchlists, backtests, paper positions and the Kite token reset on restart or redeploy.
- **Free-plan sleep.** Render free services sleep when idle; the first request can take a while.
- **Kite is unverified.** The login URL, session endpoint and SHA-256 checksum come from public docs as remembered and were not checked live. Kite tokens expire daily; expiry is not detected automatically yet.
- **Costs are assumptions.** Rates in `backend/src/domain/costs.ts` must be checked against your broker's schedule.
- **Strategy is unvalidated.** Nothing here shows the strategy has an edge. Use the backtest for learning, not as a recommendation.
- **Shared types** are duplicated in `frontend/src/types.ts`, not in a separate shared package.
- **Walk-forward** is a single out-of-sample split with no parameter re-optimisation. It is not full walk-forward testing.
