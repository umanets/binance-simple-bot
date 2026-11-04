import { SignalLogEntry } from './data-services/signal-logger.service';

/** Shape the LLM is required to return (see PredictionService.buildPrompt). */
export interface LlmPrediction {
  ticker: string;
  time: string;
  entry: number;
  stop_loss: number;
  take_profit: number;
}

export interface ZigZagPoint {
  time: number;
  price: number;
  type: 'high' | 'low';
}

/**
 * How far a recommended level may deviate from the signal price before we
 * treat the response as a hallucination (5x in either direction).
 */
export const MAX_PRICE_DEVIATION = 5;

/** Extract local pivot points (zigzag highs and lows) from OHLCV data. */
export function extractZigZag(
  candles: SignalLogEntry['candles'],
  window: number = 2,
): ZigZagPoint[] {
  const points: ZigZagPoint[] = [];
  if (!candles || candles.length < window * 2 + 1) {
    return points;
  }
  for (let i = window; i < candles.length - window; i++) {
    const curr = candles[i].close;
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (curr < candles[j].close) isHigh = false;
      if (curr > candles[j].close) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh)
      points.push({ time: candles[i].openTime, price: curr, type: 'high' });
    else if (isLow)
      points.push({ time: candles[i].openTime, price: curr, type: 'low' });
  }
  return points;
}

/**
 * Parse and validate the LLM response before any money is moved on it.
 * Rejects malformed JSON, wrong ticker, non-finite/non-positive levels,
 * inverted stop/target and levels implausibly far from the signal price.
 */
export function parseLlmPrediction(
  text: string,
  signal: SignalLogEntry,
): LlmPrediction {
  // Models occasionally wrap JSON in markdown code fences — strip them
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM response is not valid JSON: ${text.slice(0, 300)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(
      `LLM response is not a JSON object: ${cleaned.slice(0, 300)}`,
    );
  }
  const record = raw as Record<string, unknown>;
  if (record.ticker !== signal.ticker) {
    throw new Error(
      `LLM returned ticker "${String(record.ticker)}", expected "${signal.ticker}"`,
    );
  }
  for (const field of ['entry', 'stop_loss', 'take_profit'] as const) {
    const v = record[field];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new Error(
        `LLM field "${field}" is not a positive finite number: ${String(v)}`,
      );
    }
    // Guard against hallucinated magnitudes (wrong unit, lost decimal point)
    if (
      v > signal.price * MAX_PRICE_DEVIATION ||
      v < signal.price / MAX_PRICE_DEVIATION
    ) {
      throw new Error(
        `LLM field "${field}"=${v} deviates more than ${MAX_PRICE_DEVIATION}x from signal price ${signal.price}`,
      );
    }
  }
  const stopLoss = record.stop_loss as number;
  const takeProfit = record.take_profit as number;
  if (stopLoss >= takeProfit) {
    throw new Error(
      `LLM stop_loss (${stopLoss}) must be below take_profit (${takeProfit}) for a long position`,
    );
  }
  return {
    ticker: signal.ticker,
    time:
      typeof record.time === 'string' ? record.time : new Date().toISOString(),
    entry: record.entry as number,
    stop_loss: stopLoss,
    take_profit: takeProfit,
  };
}
