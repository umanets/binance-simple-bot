import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { ensureJsonFile, readJsonArray, writeJsonArray } from '../json-store';

const TRADE_LOG_PATH = path.resolve(__dirname, '../../data/trades.json');

export interface TradeLogEntry {
  ticker: string;
  qty: number;
  price: number;
  time: string; // ISO string
}

@Injectable()
export class TradeLoggerService {
  private filePath = TRADE_LOG_PATH;

  constructor() {
    ensureJsonFile(this.filePath);
  }

  async appendTrade(trade: TradeLogEntry): Promise<void> {
    const trades = await this.getAllTrades();
    trades.push(trade);
    await writeJsonArray(this.filePath, trades);
  }

  async getAllTrades(): Promise<TradeLogEntry[]> {
    return readJsonArray<TradeLogEntry>(this.filePath);
  }

  async removeTrades(tradesToRemove: TradeLogEntry[]): Promise<void> {
    const all = await this.getAllTrades();
    const toRemoveSet = new Set(
      tradesToRemove.map((t) => `${t.ticker}|${t.qty}|${t.price}|${t.time}`),
    );
    const filtered = all.filter(
      (t) => !toRemoveSet.has(`${t.ticker}|${t.qty}|${t.price}|${t.time}`),
    );
    await writeJsonArray(this.filePath, filtered);
  }
}
