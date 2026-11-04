import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { SignalLogEntry } from './data-services/signal-logger.service';
import { PredictionLoggerService } from './data-services/prediction-logger.service';
import { PredictionRecord } from './models';
import { extractZigZag, parseLlmPrediction } from './llm-prediction';

@Injectable()
export class PredictionService {
  private client: OpenAI;

  constructor(private predictionLoggerService: PredictionLoggerService) {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  private buildPrompt(entry: SignalLogEntry): string {
    // Prepare entry data without raw candles; include zigzag pivots instead
    const { candles, ...rest } = entry;
    const entryForPrompt: Record<string, unknown> = { ...rest };
    if (Array.isArray(candles)) {
      entryForPrompt.candlesCount = candles.length;
      entryForPrompt.zigzag = extractZigZag(candles);
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
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 200,
    });
    const text = resp.choices?.[0]?.message?.content?.trim() || '';
    const result = parseLlmPrediction(text, entry);
    // Strategy quirk (intentional): enter deeper, at the LLM's stop-loss level,
    // and move the stop further down to the lowest recent zigzag low.
    const entryLevel = result.stop_loss;
    let stopLoss = result.stop_loss;
    const pivots = Array.isArray(entry.candles)
      ? extractZigZag(entry.candles)
      : [];
    const lowPivots = pivots
      .filter((p) => p.type === 'low')
      .map((p) => p.price);
    if (lowPivots.length > 0) {
      stopLoss = Math.min(...lowPivots);
    }
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
