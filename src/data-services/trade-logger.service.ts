/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

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
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '[]');
    }
  }

  async appendTrade(trade: TradeLogEntry): Promise<void> {
    const trades = await this.getAllTrades();
    trades.push(trade);
    await fs.promises.writeFile(this.filePath, JSON.stringify(trades, null, 2));
  }

  async getAllTrades(): Promise<TradeLogEntry[]> {
    try {
      const text = await fs.promises.readFile(this.filePath, 'utf-8');
      return JSON.parse(text) as TradeLogEntry[];
    } catch {
      return [];
    }
  }

  async removeTrades(tradesToRemove: TradeLogEntry[]): Promise<void> {
    const all = await this.getAllTrades();
    const toRemoveSet = new Set(
      tradesToRemove.map((t) => `${t.ticker}|${t.qty}|${t.price}|${t.time}`),
    );
    const filtered = all.filter(
      (t) => !toRemoveSet.has(`${t.ticker}|${t.qty}|${t.price}|${t.time}`),
    );
    await fs.promises.writeFile(
      this.filePath,
      JSON.stringify(filtered, null, 2),
    );
  }
}
