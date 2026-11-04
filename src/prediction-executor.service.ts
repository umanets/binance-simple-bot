import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Binance, { OrderType, TimeInForce } from 'binance-api-node';
import { SignalLoggerService } from './data-services/signal-logger.service';
import { OnEvent } from '@nestjs/event-emitter';
import { PredictionLoggerService } from './data-services/prediction-logger.service';
import { D, floorToStep } from './money';

interface SymbolFilters {
  minNotional: number;
  stepSize: number;
  tickSize: number;
}

@Injectable()
export class PredictionExecutorService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly signalLogger: SignalLoggerService,
    private readonly predictionLoggerService: PredictionLoggerService) {}
  private readonly logger = new Logger(PredictionExecutorService.name);
  private client = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
  });
  private subscriptions: Record<string, () => void> = {};
  private symbolFilters: Record<string, SymbolFilters> = {};
  private predictions: PredictionRecord[] = [];
  private inProgress: Record<string, boolean> = {};

  async onModuleInit() {
    // Initial load and subscription
    this.handlePredictionsFileChange();
  }

  onModuleDestroy() {
    for (const unsub of Object.values(this.subscriptions)) {
      unsub();
    }
  }

  private async subscribeTicker(ticker: string) {
    if (this.subscriptions[ticker]) return;
    // Fetch symbol filters once
    const info = await this.client.exchangeInfo();
    const sym = info.symbols.find(s => s.symbol === ticker);
    if (!sym) {
      this.logger.warn(`Symbol ${ticker} not found in exchangeInfo; skipping subscription`);
      return;
    }
    // Support both legacy MIN_NOTIONAL and newer NOTIONAL filter types
    const minNotionalF = sym.filters.find(
      (f: any) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL'
    ) as any;
    const lotSizeF = sym.filters.find(
      (f: any) => f.filterType === 'LOT_SIZE'
    ) as any;
    const priceF = sym.filters.find(
      (f: any) => f.filterType === 'PRICE_FILTER'
    ) as any;
    const minNotional = minNotionalF ? parseFloat(minNotionalF.minNotional) : 0;
    const stepSize = lotSizeF ? parseFloat(lotSizeF.stepSize) : 0;
    const tickSize = priceF ? parseFloat(priceF.tickSize) : 0;
    this.symbolFilters[ticker] = { minNotional, stepSize, tickSize };
    // Subscribe to trade updates
    const unsub = this.client.ws.trades(ticker, trade => {
      const price = typeof trade.price === 'string' ? parseFloat(trade.price) : trade.price;
      this.handlePrice(ticker, price).catch(err =>
        this.logger.error(`Failed to handle price update for ${ticker} @ ${price}`, err?.stack ?? err)
      );
    });
    this.subscriptions[ticker] = unsub;
  }

  /**
   * Handle changes in predictions.json: subscribe to new tickers and unsubscribe removed ones.
   */
  @OnEvent('predictions.changed')
  private handlePredictionsFileChange(): void {
    const newPreds = this.predictionLoggerService.getPredictions()
    const newTickers = newPreds.map(r => r.ticker);
    // Subscribe to any new tickers
    for (const ticker of newTickers) {
      if (!this.subscriptions[ticker]) {
        this.subscribeTicker(ticker).catch(err =>
          this.logger.error(
            `Failed to subscribe to ${ticker}; will retry on the next predictions change`,
            err?.stack ?? err
          )
        );
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
    if (this.inProgress[ticker]) return;
    this.inProgress[ticker] = true;
    try {
      const recIndex = this.predictions.findIndex(r => r.ticker === ticker);
      if (recIndex === -1) return;
      const rec = this.predictions[recIndex];
      const filters = this.symbolFilters[ticker];
      if (!filters) {
        this.logger.warn(`No exchange filters cached for ${ticker}; skipping price update`);
        return;
      }
      // BUY trigger
      if (!rec.executed && price <= rec.entry) {
        const { minNotional, stepSize } = filters;
        // Target twice the minimum notional, floored to an exact lot-size multiple
        let qty = D(minNotional).div(price).mul(2);
        if (stepSize > 0) {
          qty = floorToStep(qty, stepSize);
          if (qty.lt(stepSize)) qty = D(stepSize);
        }
        // Place market buy
        const order = await this.client.order({
          symbol: ticker,
          side: 'BUY',
          type: OrderType.MARKET,
          quantity: qty.toFixed(),
        });
        const boughtQty = D((order.executedQty as string) || qty.toFixed());
        const cost = D((order.cummulativeQuoteQty as string) || '0');
        const avgPrice = boughtQty.gt(0) ? cost.div(boughtQty) : D(price);
        // Update record
        rec.executed = true;
        rec.executedQty = boughtQty.toNumber();
        rec.entryExecutedPrice = avgPrice.toNumber();
        this.predictionLoggerService.persistPredictions(this.predictions);
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
          const { stepSize, tickSize } = filters;
          const qty = floorToStep(D(rec.executedQty), stepSize);
          if (qty.lte(0)) return;
          // Quantize the limit price to the exchange tick size
          const limitPrice = floorToStep(D(sellPrice), tickSize);
          // Place limit sell, handle insufficient balance error to avoid endless retries
          try {
            await this.client.order({
              symbol: ticker,
              side: 'SELL',
              type: OrderType.LIMIT,
              timeInForce: TimeInForce.GTC,
              quantity: qty.toFixed(),
              price: limitPrice.toFixed(),
            });
          } catch (err: any) {
            // If no balance, remove prediction and unsubscribe to stop retries
            if (err.code === -2010) {
              this.logger.warn(
                `Insufficient balance for ${ticker}, removing pending sell and unsubscribing`
              );
              this.predictions.splice(recIndex, 1);
              this.predictionLoggerService.persistPredictions(this.predictions);
              const unsub = this.subscriptions[ticker];
              if (unsub) {
                unsub();
                delete this.subscriptions[ticker];
              }
              return;
            }
            throw err;
          }
          // Log to orders file
          const profit = limitPrice.minus(rec.entryExecutedPrice).mul(qty);
          this.predictionLoggerService.persistOrderLog({
            ticker,
            signalTime: rec.timestamp,
            buyPrice: rec.entryExecutedPrice!,
            qty: qty.toNumber(),
            sellTime: new Date().toISOString(),
            sellPrice: limitPrice.toNumber(),
            profit: profit.toNumber(),
          });
          // Label the original signal
          try {
            await this.signalLogger.labelSignal(
              rec.ticker,
              rec.timestamp,
              profit.toNumber()
            );
          } catch (err: any) {
            this.logger.error(
              `Failed to label signal for ${rec.ticker} @ ${rec.timestamp}`,
              err?.stack ?? err
            );
          }
          // Remove prediction and unsubscribe
          this.predictions.splice(recIndex, 1);
          this.predictionLoggerService.persistPredictions(this.predictions);
          const unsub = this.subscriptions[ticker];
          if (unsub) {
            unsub();
            delete this.subscriptions[ticker];
          }
        }
      }
    } finally {
      delete this.inProgress[ticker];
    }
  }
}
