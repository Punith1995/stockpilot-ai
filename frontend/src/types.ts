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

export interface BacktestResult { id: string; createdAt: string; source: "SAMPLE"; symbol: string; strategyId?: string; strategyName?: string; interval?: string; capital?: number; bars: number; signals: number; skipped: number; metrics: Metrics; trades: TradeRecord[]; equity?: { time: number; equity: number }[]; walkForward?: { oosFraction: number; inSample: { bars: number; metrics: Metrics }; outOfSample: { bars: number; metrics: Metrics }; note: string } | null; rolling?: { folds: { fold: number; sessions: number; from: string | null; to: string | null; trades: number; netProfit: number; winRate: number | null }[]; positiveFolds: number; note: string } | null }

export interface PaperPosition { symbol: string; qty: number; entry: number; stop: number; target: number; strategy?: string; entryReason?: string }
export interface PaperOrder { id: string; symbol: string; status: "PENDING" | "FILLED" | "REJECTED"; reason?: string; fillPrice?: number; plan: RiskPlan }
export interface PaperTrade { symbol: string; qty: number; entry: number; exit: number; reason: string; netPnl: number; exitTime: number; costs?: number; entryTime?: number; strategy?: string; entryReason?: string }
export interface PaperSnapshot { mode: "PAPER"; startCapital: number; cash: number; realizedPnl: number; emergencyStop: boolean; positions: PaperPosition[]; orders: PaperOrder[]; trades: PaperTrade[]; note: string }

export interface AppStatus { mode: string; dataSource: string; liveTrading: string; marketOpen: boolean; kite: { configured: boolean; connected: boolean; tokenSetAt: string | null; note: string }; serverTime: string; serverStartedAt?: string; alertWebhookConfigured?: boolean; note: string }
export interface BrokerStatus { configured: boolean; connected: boolean; tokenSetAt: string | null; tokenExpiresAt?: string | null; apiKeyMasked?: string | null; note: string }
export interface RecentError { at: string; status: number; code: string; path: string; message: string }

export interface Watchlist { name: string; symbols: string[] }
export interface RiskView { limits: { capital: number; maxOpenPositions: number; maxDailyLossPct: number; maxTradesPerDay: number; maxOrderValuePct: number; maxExposurePerStockPct: number }; current: { openPositions: number; dailyRealizedPnl: number; emergencyStop: boolean } }
export interface AuditEntry { at: string; action: string; target?: string; outcome: "OK" | "FAILED" }

export interface IndicatorSnapshot { source: "SAMPLE"; symbol: string; interval: number | "D"; asOf: string; close: number; changePct: number | null; values: Record<string, number | null>; summary: { trend: string; momentum: string; volume: string; emaAlignment: string; supportLevels: number[]; resistanceLevels: number[]; final: string }; note: string }
export interface MtfFrame { timeframe: string; bars: number; close: number | null; ema20: number | null; ema50: number | null; ema200: number | null; rsi14: number | null; macd: number | null; macdSignal: number | null; adx14: number | null; relVolume: number | null; trend: string; emaAlignment: string; signal: "BUY" | "WAIT"; historyEnough: boolean }
export interface MtfSummary { trendScore: number | null; bullishFrames: number; bearishFrames: number; decidedFrames: number; totalFrames: number; agreement: number | null; majorityTrend: string; buySignals: number; finalSignal: string }
export interface MtfResult { source: string; symbol: string; frames: MtfFrame[]; summary: MtfSummary; note: string }
export interface DataQuality { symbol: string; received: number; kept: number; dropped: number; duplicates: number; droppedByReason: Record<string, number>; sufficientForStrategy: boolean; lastBar: string | null }
export interface LiveGates { enabled: boolean; implemented: boolean; gates: { id: string; label: string; ok: boolean; detail?: string }[]; note: string }

export interface MarketOverviewItem { symbol: string; name: string; last: number; changePct: number; volume: number }
export interface JournalItem { key: string; symbol: string; qty: number; entry: number; exit: number; entryTime: number; exitTime: number; reason: string; netPnl: number; costs: number; note: string; noteAt: number | null; strategy?: string; entryReason?: string }
export interface ScanConfig { conditions: Record<string, { enabled: boolean; mandatory: boolean }>; rsiMin: number; rsiMax: number; minRelativeVolume: number; minAdx: number }

export interface LibraryPreset { id: string; name: string; overrides: Record<string, number>; createdAt: string }
export interface SweepRow { targetR: number; atrMultiple: number; inSample: { trades: number; netProfit: number; profitFactor: number | null; winRate?: number | null }; outOfSample: { trades: number; netProfit: number; profitFactor: number | null; maxDrawdownPct: number; winRate?: number | null; monthly?: { month: string; netPnl: number }[]; equity?: { time: number; equity: number }[] } }
export interface AlertRuleView { id: string; symbol: string; type: "PRICE_ABOVE" | "PRICE_BELOW" | "SIGNAL_BUY"; value?: number; createdAt: string; enabled: boolean; triggeredAt?: string; currentValue?: number | null }
export interface NotificationView { at: string; ruleId: string; symbol: string; message: string; delivery?: "NOT_CONFIGURED" | "DELIVERED" | "FAILED"; deliveryError?: string }
export interface KiteDataSource { defaultSource: string; kiteSessionActive: boolean; kiteInstruments: number; instrumentsLoadedAt: string | null; note: string }

export interface QuoteRow { symbol: string; last: number; change: number; changePct: number }
export interface QuotesResponse {
  source: "SAMPLE" | "KITE";
  fallbackReason: string | null;
  indices: QuoteRow[];
  stocks: QuoteRow[];
  breadth: { advancing: number; declining: number; unchanged: number };
  topGainers: QuoteRow[];
  topLosers: QuoteRow[];
  note: string;
}

export interface SimpleStrategyInfo { id: string; name: string; summary: string; bestFor: string; product: "DELIVERY" | "INTRADAY"; targetR: number; maxHoldBars: number }
export interface SimpleCompareRow {
  id: string; name: string; product: string;
  full: { trades: number; winRate: number; netProfit: number; profitFactor: number | null; maxDrawdownPct: number };
  outOfSample: { trades: number; winRate: number; netProfit: number; profitFactor: number | null; maxDrawdownPct: number };
}
export interface SimpleCompareResponse { source: string; symbol: string; ranking: string; rows: SimpleCompareRow[]; warning: string }

export interface PaperReportRow { label: string; trades: number; wins: number; losses: number; winRate: number; grossPnl: number; costs: number; netPnl: number; avgWin: number; avgLoss: number; maxDrawdown: number }
export interface PaperReport { period: "daily" | "weekly" | "monthly"; rows: PaperReportRow[]; totals: PaperReportRow; risk: { openPositions: number; capitalAtRisk: number; exposure: number; dailyLossLimit: number; todayRealizedPnl: number; dailyLossUsedPct: number }; note: string }
