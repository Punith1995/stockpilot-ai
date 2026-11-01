/**
 * Answers a free-text question about one analysis. Rule-based by default: the question is matched to
 * the analysis sections by keyword. If ANTHROPIC_API_KEY is set, the analysis data goes to a language model
 * instead, with instructions to answer only from that data. Neither path gives predictions or advice.
 */

export interface AnalysisLike {
  symbol: string;
  price: number;
  levels: { support: number; resistance: number };
  cards: { title: string; value: string; detail: string }[];
  scenarios: { title: string; text: string }[];
  risks: string[];
}

export const MAX_QUESTION = 300;

const pick = (a: AnalysisLike, title: string) => a.cards.find((c) => c.title === title);

/** Keyword routing to analysis sections. Order matters: the first matching topic wins. */
export function ruleAnswer(a: AnalysisLike, question: string): { answer: string; topic: string } {
  const q = question.toLowerCase();
  const card = (t: string) => { const c = pick(a, t); return c ? `${c.value}. ${c.detail}` : "Not available."; };
  if (/bull|upside|go up|rise/.test(q)) return { topic: "bullish", answer: a.scenarios[0]?.text ?? "No bullish case." };
  if (/bear|downside|go down|fall|break ?down/.test(q)) return { topic: "bearish", answer: a.scenarios[1]?.text ?? "No bearish case." };
  if (/invalid|level|support|resistance|range/.test(q)) return { topic: "levels", answer: `Support (20-bar low) ${a.levels.support}; resistance (20-bar high) ${a.levels.resistance}. A close below support would break the current range.` };
  if (/volume|participation|volumes/.test(q)) return { topic: "volume", answer: card("Volume") };
  if (/rsi|overbought|oversold|momentum|macd|adx/.test(q)) return { topic: "momentum", answer: card("Momentum") };
  if (/volatil|atr|how much|stop|size|risk|loss/.test(q)) return { topic: "volatility", answer: `${card("Volatility")} ${a.risks.find((r) => /ATR|stop/i.test(r)) ?? ""}`.trim() };
  if (/scanner|buy|signal|why|entry|enter/.test(q)) return { topic: "signal", answer: card("Scanner signal") };
  if (/trend|up|down|direction|ema|moving average/.test(q)) return { topic: "trend", answer: card("Trend") };
  return {
    topic: "unknown",
    answer: `I can answer about the trend, momentum, volatility, volume, the scanner signal, the levels, and the bullish and bearish cases for ${a.symbol}. Try one of those words, or one of the suggested questions.`,
  };
}

/** Calls the Anthropic Messages API with the analysis as the only source. Returns null on any failure. */
export async function llmAnswer(a: AnalysisLike, question: string, apiKey: string): Promise<string | null> {
  const system = "You answer questions about one stock analysis. Use only the JSON data provided. If the data does not answer the question, say so. Do not predict prices, do not give investment advice, and state that the data is SAMPLE and not real market data. Answer in at most 4 sentences.";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-5-5", max_tokens: 300, system,
        messages: [{ role: "user", content: `Analysis data: ${JSON.stringify(a)}\n\nQuestion: ${question}` }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = json.content?.find((c) => c.type === "text")?.text?.trim();
    return text && text.length ? text : null;
  } catch {
    return null;
  }
}
