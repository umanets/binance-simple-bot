import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface GhostTradeEntry {
  ticker: string;
  price: number;
}

const GHOST_BUY_PATH = path.resolve(__dirname, '../ghost_buy_trades.json');
const GHOST_SELL_PATH = path.resolve(__dirname, '../ghost_sell_trades.json');

@Injectable()
export class GhostTradeService {
  private buyPath = GHOST_BUY_PATH;
  private sellPath = GHOST_SELL_PATH;

  constructor() {
    // Ensure ghost files exist
    if (!fs.existsSync(this.buyPath)) {
      fs.writeFileSync(this.buyPath, '[]');
    }
    if (!fs.existsSync(this.sellPath)) {
      fs.writeFileSync(this.sellPath, '[]');
    }
  }

  // Retrieve all ghost buy trades
  async getGhostBuyTrades(): Promise<GhostTradeEntry[]> {
    try {
      const data = await fs.promises.readFile(this.buyPath, 'utf-8');
      return JSON.parse(data) as GhostTradeEntry[];
    } catch {
      return [];
    }
  }

  // Retrieve all ghost sell trades
  async getGhostSellTrades(): Promise<GhostTradeEntry[]> {
    try {
      const data = await fs.promises.readFile(this.sellPath, 'utf-8');
      return JSON.parse(data) as GhostTradeEntry[];
    } catch {
      return [];
    }
  }

  // Add a ghost buy trade
  async addGhostBuyTrade(entry: GhostTradeEntry): Promise<void> {
    const trades = await this.getGhostBuyTrades();
    trades.push(entry);
    await fs.promises.writeFile(this.buyPath, JSON.stringify(trades, null, 2));
  }

  // Add a ghost sell trade
  async addGhostSellTrade(entry: GhostTradeEntry): Promise<void> {
    const trades = await this.getGhostSellTrades();
    trades.push(entry);
    await fs.promises.writeFile(this.sellPath, JSON.stringify(trades, null, 2));
  }

  // Remove all ghost trades for a specific ticker
  async removeTradesByTicker(ticker: string): Promise<void> {
    // Clean buy trades
    const buyTrades = await this.getGhostBuyTrades();
    const filteredBuys = buyTrades.filter(t => t.ticker !== ticker);
    await fs.promises.writeFile(this.buyPath, JSON.stringify(filteredBuys, null, 2));
    // Clean sell trades
    const sellTrades = await this.getGhostSellTrades();
    const filteredSells = sellTrades.filter(t => t.ticker !== ticker);
    await fs.promises.writeFile(this.sellPath, JSON.stringify(filteredSells, null, 2));
  }
}