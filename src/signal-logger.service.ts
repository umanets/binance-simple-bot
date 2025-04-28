import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface SignalLogEntry {
  timestamp: string;
  ticker: string;
  direction: string;
  price: number;
  buyCoef: number;
  sellCoef: number;
  atr: number;
  stdev: number;
  volRatio: number;
  reliability: number;
  ghostBuys: number;
  ghostSells: number;
  ghostPairsCount: number;
  tradeCount: number;
  initialFib: number;
  a: number;
  k: number;
  fibN: number;
  nextStepCoef: number;
  candles?: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    openTime: number;
  }[];
}

const SIGNAL_LOG_PATH = path.resolve(__dirname, '../signals_log.json');
// File to hold labeled signals (original signal + profit)
const LABELED_SIGNALS_PATH = path.resolve(__dirname, '../signals_log_labeled.json');

@Injectable()
export class SignalLoggerService {
  private filePath = SIGNAL_LOG_PATH;
  private labeledFilePath = LABELED_SIGNALS_PATH;

  constructor() {
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '[]');
    }
    // Ensure labeled signals file exists
    if (!fs.existsSync(this.labeledFilePath)) {
      fs.writeFileSync(this.labeledFilePath, '[]');
    }
  }

  async appendSignal(entry: SignalLogEntry): Promise<void> {
    try {
      const text = await fs.promises.readFile(this.filePath, 'utf-8');
      const arr = JSON.parse(text) as SignalLogEntry[];
      arr.push(entry);
      await fs.promises.writeFile(
        this.filePath,
        JSON.stringify(arr, null, 2)
      );
    } catch {
      await fs.promises.writeFile(
        this.filePath,
        JSON.stringify([entry], null, 2)
      );
    }
  }
  /**
   * Label a signal with its profit and write to labeled file.
   */
  async labelSignal(
    ticker: string,
    timestamp: string,
    profit: number
  ): Promise<void> {
    try {
      // Read original signals
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const signals = JSON.parse(raw) as SignalLogEntry[];
      const sig = signals.find(s => s.ticker === ticker && s.timestamp === timestamp);
      if (!sig) {
        console.warn(`SignalLoggerService: signal not found for labeling ${ticker}@${timestamp}`);
        return;
      }
      // Read existing labeled entries
      const rawLabeled = await fs.promises.readFile(this.labeledFilePath, 'utf-8');
      const labeledArr = JSON.parse(rawLabeled) as any[];
      // Filter out any existing label for this signal
      const updated = labeledArr.filter(
        r => !(r.ticker === ticker && r.timestamp === timestamp)
      );
      // Append new labeled record
      const newRecord = { ...sig, profit };
      updated.push(newRecord);
      await fs.promises.writeFile(
        this.labeledFilePath,
        JSON.stringify(updated, null, 2)
      );
    } catch (err) {
      console.error('Error in labelSignal:', err);
    }
  }
}