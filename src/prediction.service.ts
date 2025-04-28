import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { SignalLogEntry } from './signal-logger.service';

const PREDICTIONS_PATH = path.resolve(__dirname, '../predictions.json');

@Injectable()
export class PredictionService {
  private client: any;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    if (!fs.existsSync(PREDICTIONS_PATH)) {
      fs.writeFileSync(PREDICTIONS_PATH, '[]');
    }
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

  async predict(entry: SignalLogEntry): Promise<any> {
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
    let result: any;
    try {
      result = JSON.parse(text);
    } catch (err) {
      throw new Error('Failed to parse LLM response as JSON: ' + text);
    }
    // Post-process LLM output: use its stop_loss as the new entry,
    // and enforce stop_loss to be the lowest zigzag low
    const originalSL = result.stop_loss;
    // override entry to the LLM-provided stop_loss
    result.entry = originalSL;
    // compute zigzag pivots from raw candles, if available
    const pivots = Array.isArray(entry.candles)
      ? this.extractZigZag(entry.candles)
      : [];
    const lowPivots = pivots.filter(p => p.type === 'low').map(p => p.price);
    if (lowPivots.length > 0) {
      result.stop_loss = Math.min(...lowPivots);
    }
    // Build record with a default executed flag
    const record = { timestamp: new Date().toISOString(), executed: false, ...result };
    // Persist prediction: replace any existing unexecuted entry for this ticker
    const arr = JSON.parse(fs.readFileSync(PREDICTIONS_PATH, 'utf-8')) as any[];
    const updated = arr.filter(
      (r: any) => !(r.ticker === record.ticker && r.executed === false)
    );
    updated.push(record);
    fs.writeFileSync(PREDICTIONS_PATH, JSON.stringify(updated, null, 2));
    return record;
  }
}