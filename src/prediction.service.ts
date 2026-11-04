import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { SignalLogEntry } from './data-services/signal-logger.service';
import { PredictionLoggerService } from './data-services/prediction-logger.service';

/** Shape the LLM is required to return (see buildPrompt). */
interface LlmPrediction {
  ticker: string;
  time: string;
  entry: number;
  stop_loss: number;
  take_profit: number;
}

/**
 * How far a recommended level may deviate from the signal price before we
 * treat the response as a hallucination (5x in either direction).
 */
const MAX_PRICE_DEVIATION = 5;

@Injectable()
export class PredictionService {
  private client: OpenAI;
  private readonly logger = new Logger(PredictionService.name);

  constructor(private predictionLoggerService: PredictionLoggerService) {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  /**
   * Extract local pivot points (zigzag highs and lows) from OHLCV data.
   */
  private extractZigZag(
    candles: SignalLogEntry['candles'],
    window: number = 2
  ): { time: number; price: number; type: 'high' | 'low' }[] {
    const points: { time: number; price: number; type: 'high' | 'low' }[] = [];
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
      if (isHigh) points.push({ time: candles[i].openTime, price: curr, type: 'high' });
      else if (isLow) points.push({ time: candles[i].openTime, price: curr, type: 'low' });
    }
    return points;
  }

  private buildPrompt(entry: SignalLogEntry): string {
    // Prepare entry data without raw candles; include zigzag pivots instead
    const { candles, ...rest } = entry;
    const entryForPrompt: any = { ...rest };
    if (Array.isArray(candles)) {
      entryForPrompt.candlesCount = candles.length;
      entryForPrompt.zigzag = this.extractZigZag(candles);
    }
    return `You are a crypto‐trading assistant.
Below is the context for the latest ${entry.direction === 'aBuy' ? 'buy' : 'sell'} signal on ${entry.ticker}:

Fields:
 • price        — the raw signal price at time of alert
 • buyCoef      — confidence from buy‐side multi‐timeframe analysis (0..64)
 • sellCoef     — confidence from sell‐side multi‐timeframe analysis (0..64)
 • atr          — normalized Average True Range (ATR(14)/price)
 • stdev        — standard deviation of recent log‐returns
 • volRatio     — volume / SMA(volume,20) (liquidity measure)
 • reliability  — fraction of past signals (last N) that hit profit target
 • ghostBuys    — count of prior rejected buy attempts
 • ghostSells   — count of prior rejected sell attempts
 • ghostPairs   — = min(ghostBuys, ghostSells)
 • tradeCount   — number of actual buys executed for this ticker
 • initialFib   — Fibonacci index based on tradeCount
 • k            — dynamically computed shrink coefficient
 • nextStepCoef — resulting threshold multiplier
 • candlesCount — number of historical bars provided
 • zigzag       — array of local pivot points (highs/lows) from recent price data

${JSON.stringify(entryForPrompt, null, 2)}

Based on the above context and recent market conditions, please recommend:
  1) An entry price level to ${entry.direction === 'aBuy' ? 'open a long' : 'close or reverse/short'} position
  2) A stop‐loss level
  3) A take‐profit level

Respond with exactly one JSON object:
{
  "ticker": "${entry.ticker}",
  "time":   "${new Date().toISOString()}",
  "entry": <number>,
  "stop_loss": <number>,
  "take_profit": <number>
}`;
  }

  /**
   * Parse and validate the LLM response before any money is moved on it.
   * Rejects malformed JSON, wrong ticker, non-finite/non-positive levels,
   * inverted stop/target and levels implausibly far from the signal price.
   */
  private parseLlmPrediction(text: string, signal: SignalLogEntry): LlmPrediction {
    // Models occasionally wrap JSON in markdown code fences — strip them
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let raw: any;
    try {
      raw = JSON.parse(cleaned);
    } catch {
      throw new Error(`LLM response is not valid JSON: ${text.slice(0, 300)}`);
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`LLM response is not a JSON object: ${cleaned.slice(0, 300)}`);
    }
    if (raw.ticker !== signal.ticker) {
      throw new Error(`LLM returned ticker "${raw.ticker}", expected "${signal.ticker}"`);
    }
    for (const field of ['entry', 'stop_loss', 'take_profit'] as const) {
      const v = raw[field];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        throw new Error(`LLM field "${field}" is not a positive finite number: ${v}`);
      }
      // Guard against hallucinated magnitudes (wrong unit, lost decimal point)
      if (v > signal.price * MAX_PRICE_DEVIATION || v < signal.price / MAX_PRICE_DEVIATION) {
        throw new Error(
          `LLM field "${field}"=${v} deviates more than ${MAX_PRICE_DEVIATION}x from signal price ${signal.price}`
        );
      }
    }
    if (raw.stop_loss >= raw.take_profit) {
      throw new Error(
        `LLM stop_loss (${raw.stop_loss}) must be below take_profit (${raw.take_profit}) for a long position`
      );
    }
    return {
      ticker: raw.ticker,
      time: typeof raw.time === 'string' ? raw.time : new Date().toISOString(),
      entry: raw.entry,
      stop_loss: raw.stop_loss,
      take_profit: raw.take_profit,
    };
  }

  async predict(entry: SignalLogEntry): Promise<PredictionRecord | undefined> {
    // Only perform predictions for buy signals
    if (entry.direction !== 'aBuy') {
      return undefined;
    }
    const prompt = this.buildPrompt(entry);
    const resp = await this.client.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a trading assistant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 200,
    });
    const text = resp.choices?.[0]?.message?.content?.trim() || '';
    const result = this.parseLlmPrediction(text, entry);
    // Strategy quirk (intentional): enter deeper, at the LLM's stop-loss level,
    // and move the stop further down to the lowest recent zigzag low.
    const entryLevel = result.stop_loss;
    let stopLoss = result.stop_loss;
    const pivots = Array.isArray(entry.candles)
      ? this.extractZigZag(entry.candles)
      : [];
    const lowPivots = pivots.filter(p => p.type === 'low').map(p => p.price);
    if (lowPivots.length > 0) {
      stopLoss = Math.min(...lowPivots);
    }
    // Build record with a default executed flag
    const record: PredictionRecord = {
      timestamp: new Date().toISOString(),
      executed: false,
      ticker: result.ticker,
      entry: entryLevel,
      stop_loss: stopLoss,
      take_profit: result.take_profit,
    };
    // Persist prediction: replace any existing unexecuted entry for this ticker
    this.predictionLoggerService.persistPrediction(record);
    return record;
  }
}
