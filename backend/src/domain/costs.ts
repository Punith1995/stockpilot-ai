/**
 * Indian equity transaction-cost model. Rates are ASSUMPTIONS that must be checked
 * against the current brokerage plan and exchange/regulator schedules before use.
 * Every rate is a percentage of turnover unless stated.
 */
export type ProductType = "DELIVERY" | "INTRADAY";

export const COST_ASSUMPTIONS = {
  brokeragePct: 0.03,        // broker commission, % of turnover (assumed plan)
  brokerageCapPerOrder: 20,  // ₹ cap per order (assumed plan)
  exchangePct: 0.00297,      // NSE transaction charge, both sides
  sebiPct: 0.0001,           // SEBI turnover fee, both sides
  gstPct: 18,                // GST on brokerage + exchange + SEBI
  delivery: { sttPct: 0.1, sttSide: "BOTH" as const, stampBuyPct: 0.015 },
  intraday: { sttPct: 0.025, sttSide: "SELL" as const, stampBuyPct: 0.003 },
} as const;

export interface CostBreakdown {
  brokerage: number; stt: number; exchange: number; sebi: number; stamp: number; gst: number; total: number;
}

export function tradeCosts(product: ProductType, buyValue: number, sellValue: number): CostBreakdown {
  const a = COST_ASSUMPTIONS;
  const p = product === "DELIVERY" ? a.delivery : a.intraday;
  const turnover = buyValue + sellValue;
  const brokerage = Math.min(
    (a.brokeragePct / 100) * buyValue, a.brokerageCapPerOrder,
  ) + Math.min((a.brokeragePct / 100) * sellValue, a.brokerageCapPerOrder);
  const sttBase = p.sttSide === "BOTH" ? turnover : sellValue;
  const stt = (p.sttPct / 100) * sttBase;
  const exchange = (a.exchangePct / 100) * turnover;
  const sebi = (a.sebiPct / 100) * turnover;
  const stamp = (p.stampBuyPct / 100) * buyValue;
  const gst = (a.gstPct / 100) * (brokerage + exchange + sebi);
  const r = (v: number) => Math.round(v * 100) / 100;
  const parts = { brokerage: r(brokerage), stt: r(stt), exchange: r(exchange), sebi: r(sebi), stamp: r(stamp), gst: r(gst) };
  return { ...parts, total: r(Object.values(parts).reduce((s, v) => s + v, 0)) };
}
