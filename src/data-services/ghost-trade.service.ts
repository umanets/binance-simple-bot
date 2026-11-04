import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { ensureJsonFile, readJsonArray, writeJsonArray } from '../json-store';

export interface GhostTradeEntry {
  ticker: string;
  price: number;
}

const GHOST_BUY_PATH = path.resolve(
  __dirname,
  '../../data/ghost_buy_trades.json',
);
const GHOST_SELL_PATH = path.resolve(
  __dirname,
  '../../data/ghost_sell_trades.json',
);

@Injectable()
export class GhostTradeService {
  private buyPath = GHOST_BUY_PATH;
  private sellPath = GHOST_SELL_PATH;

  constructor() {
    ensureJsonFile(this.buyPath);
    ensureJsonFile(this.sellPath);
  }

  async getGhostBuyTrades(): Promise<GhostTradeEntry[]> {
    return readJsonArray<GhostTradeEntry>(this.buyPath);
  }

  async getGhostSellTrades(): Promise<GhostTradeEntry[]> {
    return readJsonArray<GhostTradeEntry>(this.sellPath);
  }

  async addGhostBuyTrade(entry: GhostTradeEntry): Promise<void> {
    const trades = await this.getGhostBuyTrades();
    trades.push(entry);
    await writeJsonArray(this.buyPath, trades);
  }

  async addGhostSellTrade(entry: GhostTradeEntry): Promise<void> {
    const trades = await this.getGhostSellTrades();
    trades.push(entry);
    await writeJsonArray(this.sellPath, trades);
  }

  /** Remove all ghost trades (both sides) for a specific ticker. */
  async removeTradesByTicker(ticker: string): Promise<void> {
    const buyTrades = await this.getGhostBuyTrades();
    await writeJsonArray(
      this.buyPath,
      buyTrades.filter((t) => t.ticker !== ticker),
    );
    const sellTrades = await this.getGhostSellTrades();
    await writeJsonArray(
      this.sellPath,
      sellTrades.filter((t) => t.ticker !== ticker),
    );
  }
}
