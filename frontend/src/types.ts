/** Shared API shapes. Mirrors the backend responses; keep in sync with backend/src. */
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface Instrument { symbol: string; name: string; exchange: string; basePrice: number }

export interface CheckResult { id: string; label: string; enabled: boolean; mandatory: boolean; pass: boolean | null; detail: string }
export interface RiskPlan { entry: number; stop: number; target: number; qty: number; riskPerShare: number; riskAmount: number; rewardRisk: number }
export interface Evaluation { index: number; time: number; signal: "BUY" | "WAIT"; checks: CheckResult[]; failedMandatory: string[]; plan: RiskPlan | null; planReason?: string }

export interface ScanRow { symbol: string; signal: "BUY" | "WAIT"; failedMandatory: string[]; passedChecks: number; totalChecks: number; plan: RiskPlan | null }

export interface StrategyInfo {
  id: string;
  name: string;
  config: Record<string, unknown> & { conditions: Record<string, { enabled: boolean; mandatory: boolean }> };
  labels: Record<string, string>;
  note: string;
}

export interface Metrics {
  trades: number; wins: number; losses: number; winRate: number | null; netProfit: number; netReturnPct: number;
  profitFactor: number | null; maxDrawdown: number; maxDrawdownPct: number; averageWin: number | null; averageLoss: number | null;
  expectancyR: number | null; rewardToRisk: number | null; warnings: string[];
}

export interface TradeRecord { symbol: string; entryPrice: number; exitPrice: number; qty: number; exitReason: string; netPnl: number; rMultiple: number; barsHeld: number; exitTime: number }

export interface BacktestResult { id: string; createdAt: string; source: "SAMPLE"; symbol: string; bars: number; signals: number; skipped: number; metrics: Metrics; trades: TradeRecord[]; walkForward?: { oosFraction: number; inSample: { bars: number; metrics: Metrics }; outOfSample: { bars: number; metrics: Metrics }; note: string } | null }

export interface PaperPosition { symbol: string; qty: number; entry: number; stop: number; target: number }
export interface PaperOrder { id: string; symbol: string; status: "PENDING" | "FILLED" | "REJECTED"; reason?: string; fillPrice?: number; plan: RiskPlan }
export interface PaperTrade { symbol: string; qty: number; entry: number; exit: number; reason: string; netPnl: number }
export interface PaperSnapshot { mode: "PAPER"; startCapital: number; cash: number; realizedPnl: number; emergencyStop: boolean; positions: PaperPosition[]; orders: PaperOrder[]; trades: PaperTrade[]; note: string }

export interface AppStatus { mode: string; dataSource: string; liveTrading: string; marketOpen: boolean; kite: { configured: boolean; connected: boolean; tokenSetAt: string | null; note: string }; serverTime: string; note: string }
export interface BrokerStatus { configured: boolean; connected: boolean; tokenSetAt: string | null; note: string }

export interface Watchlist { name: string; symbols: string[] }
export interface RiskView { limits: { capital: number; maxOpenPositions: number; maxDailyLossPct: number; maxTradesPerDay: number; maxOrderValuePct: number; maxExposurePerStockPct: number }; current: { openPositions: number; dailyRealizedPnl: number; emergencyStop: boolean } }
export interface AuditEntry { at: string; action: string; target?: string; outcome: "OK" | "FAILED" }

export interface IndicatorSnapshot { symbol: string; asOf: string; close: number; values: Record<string, number | null>; note: string }
export interface MtfFrame { interval: number; bars: number; close: number | null; ema20: number | null; ema50: number | null; rsi14: number | null; bias: string }
export interface MtfResult { symbol: string; frames: MtfFrame[]; alignment: string; note: string }
export interface DataQuality { symbol: string; received: number; kept: number; dropped: number; duplicates: number; droppedByReason: Record<string, number>; sufficientForStrategy: boolean; lastBar: string | null }
export interface LiveGates { enabled: boolean; implemented: boolean; gates: { id: string; label: string; ok: boolean; detail?: string }[]; note: string }

export interface MarketOverviewItem { symbol: string; name: string; last: number; changePct: number; volume: number }
export interface JournalItem { key: string; symbol: string; qty: number; entry: number; exit: number; entryTime: number; exitTime: number; reason: string; netPnl: number; costs: number; note: string }
export interface ScanConfig { conditions: Record<string, { enabled: boolean; mandatory: boolean }>; rsiMin: number; rsiMax: number; minRelativeVolume: number; minAdx: number }

export interface LibraryPreset { id: string; name: string; overrides: Record<string, number>; createdAt: string }
export interface SweepRow { targetR: number; atrMultiple: number; inSample: { trades: number; netProfit: number; profitFactor: number | null }; outOfSample: { trades: number; netProfit: number; profitFactor: number | null; maxDrawdownPct: number } }
export interface AlertRuleView { id: string; symbol: string; type: "PRICE_ABOVE" | "PRICE_BELOW" | "SIGNAL_BUY"; value?: number; createdAt: string }
export interface NotificationView { at: string; ruleId: string; symbol: string; message: string; delivery?: "NOT_CONFIGURED" | "DELIVERED" | "FAILED"; deliveryError?: string }
export interface KiteDataSource { defaultSource: string; kiteSessionActive: boolean; kiteInstruments: number; instrumentsLoadedAt: string | null; note: string }
