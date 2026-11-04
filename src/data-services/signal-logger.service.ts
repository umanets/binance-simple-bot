import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { ensureJsonFile, readJsonArray, writeJsonArray } from '../json-store';

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

export type LabeledSignalEntry = SignalLogEntry & { profit: number };

const SIGNAL_LOG_PATH = path.resolve(__dirname, '../../data/signals_log.json');
// File to hold labeled signals (original signal + profit)
const LABELED_SIGNALS_PATH = path.resolve(
  __dirname,
  '../../data/signals_log_labeled.json',
);

@Injectable()
export class SignalLoggerService {
  private readonly logger = new Logger(SignalLoggerService.name);
  private filePath = SIGNAL_LOG_PATH;
  private labeledFilePath = LABELED_SIGNALS_PATH;

  constructor() {
    ensureJsonFile(this.filePath);
    ensureJsonFile(this.labeledFilePath);
  }

  async appendSignal(entry: SignalLogEntry): Promise<void> {
    const signals = await readJsonArray<SignalLogEntry>(this.filePath);
    signals.push(entry);
    await writeJsonArray(this.filePath, signals);
  }

  /**
   * Label a signal with its realized profit and write it to the labeled
   * file, replacing any previous label for the same signal.
   */
  async labelSignal(
    ticker: string,
    timestamp: string,
    profit: number,
  ): Promise<void> {
    const signals = await readJsonArray<SignalLogEntry>(this.filePath);
    const sig = signals.find(
      (s) => s.ticker === ticker && s.timestamp === timestamp,
    );
    if (!sig) {
      this.logger.warn(`Signal not found for labeling ${ticker}@${timestamp}`);
      return;
    }
    const labeled = await readJsonArray<LabeledSignalEntry>(
      this.labeledFilePath,
    );
    const updated = labeled.filter(
      (r) => !(r.ticker === ticker && r.timestamp === timestamp),
    );
    updated.push({ ...sig, profit });
    await writeJsonArray(this.labeledFilePath, updated);
  }
}
