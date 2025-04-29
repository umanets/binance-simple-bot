import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import Binance, { OrderType, TimeInForce } from 'binance-api-node';
import { SignalLoggerService } from './signal-logger.service';

const PREDICTIONS_PATH = path.resolve(__dirname, '../predictions.json');
const ORDERS_LOG_PATH = path.resolve(__dirname, '../prediction-orders.json');

interface PredictionRecord {
  ticker: string;
  entry: number;
  stop_loss: number;
  take_profit: number;
  executed: boolean;
  executedQty?: number;
  entryExecutedPrice?: number;
  timestamp: string;
}

interface OrderLog {
  ticker: string;
  /** Original signal timestamp (from SignalLogEntry.timestamp) */
  signalTime: string;
  buyPrice: number;
  qty: number;
  sellTime: string;
  sellPrice: number;
  profit: number;
}

@Injectable()
export class PredictionExecutorService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly signalLogger: SignalLoggerService) {}
  private client = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
  });
  private subscriptions: Record<string, () => void> = {};
  private symbolFilters: Record<string, { minNotional: number; stepSize: number }> = {};
  private predictions: PredictionRecord[] = [];

  private watcher?: fs.FSWatcher;
  async onModuleInit() {
    // Ensure orders log exists
    if (!fs.existsSync(ORDERS_LOG_PATH)) {
      fs.writeFileSync(ORDERS_LOG_PATH, '[]');
    }
    // Ensure predictions file exists before watching
    if (!fs.existsSync(PREDICTIONS_PATH)) {
      fs.writeFileSync(PREDICTIONS_PATH, '[]');
    }
    // Initial load and subscription
    this.handlePredictionsFileChange();
    // Watch for changes in predictions.json to subscribe/unsubscribe dynamically
    try {
      this.watcher = fs.watch(PREDICTIONS_PATH, (eventType) => {
        if (eventType === 'change') {
          this.handlePredictionsFileChange();
        }
      });
    } catch (err) {
      console.error('Failed to watch predictions.json:', err);
    }
  }

  onModuleDestroy() {
    // Unsubscribe all sockets
    for (const unsub of Object.values(this.subscriptions)) {
      unsub();
    }
    // Stop file watcher
    if (this.watcher) {
      this.watcher.close();
    }
  }

  private loadPredictions() {
    try {
      const data = fs.readFileSync(PREDICTIONS_PATH, 'utf-8');
      this.predictions = JSON.parse(data) as PredictionRecord[];
    } catch {
      this.predictions = [];
    }
  }

  private persistPredictions() {
    fs.writeFileSync(
      PREDICTIONS_PATH,
      JSON.stringify(this.predictions, null, 2)
    );
  }

  private persistOrderLog(log: OrderLog) {
    const arr: OrderLog[] = JSON.parse(
      fs.readFileSync(ORDERS_LOG_PATH, 'utf-8')
    );
    arr.push(log);
    fs.writeFileSync(ORDERS_LOG_PATH, JSON.stringify(arr, null, 2));
  }

  private async subscribeTicker(ticker: string) {
    if (this.subscriptions[ticker]) return;
    // Fetch symbol filters once
    const info = await this.client.exchangeInfo();
    const sym = info.symbols.find(s => s.symbol === ticker);
    if (!sym) return;
    // Support both legacy MIN_NOTIONAL and newer NOTIONAL filter types
    const minNotionalF = sym.filters.find(
      (f: any) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL'
    ) as any;
    const lotSizeF = sym.filters.find(
      (f: any) => f.filterType === 'LOT_SIZE'
    ) as any;
    const minNotional = minNotionalF ? parseFloat(minNotionalF.minNotional) : 0;
    const stepSize = lotSizeF ? parseFloat(lotSizeF.stepSize) : 0;
    this.symbolFilters[ticker] = { minNotional, stepSize };
    // Subscribe to trade updates
    const unsub = this.client.ws.trades(ticker, trade => {
      const price = typeof trade.price === 'string' ? parseFloat(trade.price) : trade.price;
      this.handlePrice(ticker, price).catch(err => console.error(err));
    });
    this.subscriptions[ticker] = unsub;
  }

  /**
   * Handle changes in predictions.json: subscribe to new tickers and unsubscribe removed ones.
   */
  private handlePredictionsFileChange(): void {
    let newPreds: PredictionRecord[] = [];
    try {
      const data = fs.readFileSync(PREDICTIONS_PATH, 'utf-8');
      newPreds = JSON.parse(data) as PredictionRecord[];
    } catch {
      newPreds = [];
    }
    const newTickers = newPreds.map(r => r.ticker);
    // Subscribe to any new tickers
    for (const ticker of newTickers) {
      if (!this.subscriptions[ticker]) {
        this.subscribeTicker(ticker).catch(err => console.error(err));
      }
    }
    // Unsubscribe tickers no longer in predictions
    for (const ticker of Object.keys(this.subscriptions)) {
      if (!newTickers.includes(ticker)) {
        const unsub = this.subscriptions[ticker];
        if (unsub) unsub();
        delete this.subscriptions[ticker];
      }
    }
    // Update in-memory list
    this.predictions = newPreds;
  }

  private async handlePrice(ticker: string, price: number) {
    const recIndex = this.predictions.findIndex(r => r.ticker === ticker);
    if (recIndex === -1) return;
    const rec = this.predictions[recIndex];
    // BUY trigger
    if (!rec.executed && price <= rec.entry) {
      const { minNotional, stepSize } = this.symbolFilters[ticker];
      let qty = (minNotional / price) * 2;
      if (stepSize > 0) {
        qty = qty - (qty % stepSize);
        if (qty < stepSize) qty = stepSize;
      }
      // Place market buy
      const order = await this.client.order({
        symbol: ticker,
        side: 'BUY',
        type: OrderType.MARKET,
        quantity: qty.toFixed(8),
      });
      const boughtQty = parseFloat((order.executedQty as string) || qty.toString());
      const cost = parseFloat((order.cummulativeQuoteQty as string) || '0');
      const avgPrice = boughtQty > 0 ? cost / boughtQty : price;
      // Update record
      rec.executed = true;
      rec.executedQty = boughtQty;
      rec.entryExecutedPrice = avgPrice;
      this.persistPredictions();
      return;
    }
    // SELL trigger (TP or SL)
    if (rec.executed) {
      const tp = rec.take_profit;
      const sl = rec.stop_loss;
      let doSell = false;
      let sellPrice = tp;
      if (price >= tp) {
        doSell = true;
        sellPrice = tp;
      } else if (price <= sl) {
        doSell = true;
        sellPrice = sl;
      }
      if (doSell && rec.executedQty && rec.entryExecutedPrice !== undefined) {
        let qty = rec.executedQty;
        const stepSize = this.symbolFilters[ticker].stepSize;
        if (stepSize > 0) qty = qty - (qty % stepSize);
        if (qty <= 0) return;
        // Place limit sell
        await this.client.order({
          symbol: ticker,
          side: 'SELL',
          type: OrderType.LIMIT,
          timeInForce: TimeInForce.GTC,
          quantity: qty.toFixed(8),
          price: sellPrice.toFixed(8),
        });
        // Log to orders file
        const profit = (sellPrice - rec.entryExecutedPrice) * qty;
        this.persistOrderLog({
          ticker,
          signalTime: rec.timestamp,
          buyPrice: rec.entryExecutedPrice!,
          qty,
          sellTime: new Date().toISOString(),
          sellPrice,
          profit,
        });
        // Label the original signal with profit in signals_log_labeled.json
        try {
          await this.signalLogger.labelSignal(
            rec.ticker,
            rec.timestamp,
            profit
          );
        } catch (err) {
          console.error('Error labeling signal in SignalLoggerService:', err);
        }
        // Remove prediction and unsubscribe
        this.predictions.splice(recIndex, 1);
        this.persistPredictions();
        const unsub = this.subscriptions[ticker];
        if (unsub) {
          unsub(); delete this.subscriptions[ticker];
        }
      }
    }
  }
}