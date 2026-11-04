import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { OrderType, TimeInForce } from 'binance-api-node';
import { OnEvent } from '@nestjs/event-emitter';
import { SignalLoggerService } from '../data-services/signal-logger.service';
import { PredictionLoggerService } from '../data-services/prediction-logger.service';
import { PredictionRecord } from '../models';
import { D, floorToStep } from '../money';
import * as binance from '../binance';
import { client } from '../binance';

interface SymbolFilters {
  minNotional: number;
  stepSize: number;
  tickSize: number;
}

/** Binance API error code for "Account has insufficient balance". */
export const BINANCE_INSUFFICIENT_BALANCE = -2010;

function errorDetail(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

/**
 * Watches predictions.json and trades LLM predictions live over Binance
 * WebSocket price streams.
 *
 * Disabled by default: live trading only starts when the
 * ENABLE_PREDICTION_EXECUTOR environment variable is set to 'true'.
 */
@Injectable()
export class PredictionExecutorService
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    private readonly signalLogger: SignalLoggerService,
    private readonly predictionLoggerService: PredictionLoggerService,
  ) {}
  private readonly logger = new Logger(PredictionExecutorService.name);
  private readonly enabled = process.env.ENABLE_PREDICTION_EXECUTOR === 'true';
  private subscriptions: Record<string, () => void> = {};
  private symbolFilters: Record<string, SymbolFilters> = {};
  private predictions: PredictionRecord[] = [];
  private inProgress: Record<string, boolean> = {};

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log(
        'Prediction executor disabled (set ENABLE_PREDICTION_EXECUTOR=true to trade LLM predictions live)',
      );
      return;
    }
    await this.handlePredictionsFileChange();
  }

  onModuleDestroy() {
    for (const unsub of Object.values(this.subscriptions)) {
      unsub();
    }
    this.subscriptions = {};
  }

  private async subscribeTicker(ticker: string) {
    if (this.subscriptions[ticker]) return;
    // Fetch symbol filters once
    const filters = await binance.spotSymbolFilters(ticker);
    if (!filters) {
      this.logger.warn(
        `Symbol ${ticker} not found in exchangeInfo; skipping subscription`,
      );
      return;
    }
    this.symbolFilters[ticker] = filters;
    // Subscribe to trade updates
    const unsub = client.ws.trades(ticker, (trade) => {
      const price =
        typeof trade.price === 'string' ? parseFloat(trade.price) : trade.price;
      this.handlePrice(ticker, price).catch((err: unknown) =>
        this.logger.error(
          `Failed to handle price update for ${ticker} @ ${price}`,
          errorDetail(err),
        ),
      );
    });
    this.subscriptions[ticker] = unsub;
  }

  /**
   * Handle changes in predictions.json: subscribe to new tickers and
   * unsubscribe removed ones. Keeps the previous subscription set when the
   * file is temporarily unreadable. This service's own writes re-trigger the
   * handler via fs.watch; that echo is harmless because the handler only
   * re-reads state and diffs subscriptions — it never writes.
   */
  @OnEvent('predictions.changed')
  private async handlePredictionsFileChange(): Promise<void> {
    if (!this.enabled) return;
    let newPreds: PredictionRecord[];
    try {
      newPreds = await this.predictionLoggerService.getPredictions();
    } catch (err) {
      this.logger.error(
        'Failed to read predictions.json; keeping current subscriptions',
        err instanceof Error ? err.stack : String(err),
      );
      return;
    }
    const newTickers = newPreds.map((r) => r.ticker);
    // Subscribe to any new tickers
    for (const ticker of newTickers) {
      if (!this.subscriptions[ticker]) {
        this.subscribeTicker(ticker).catch((err: unknown) =>
          this.logger.error(
            `Failed to subscribe to ${ticker}; will retry on the next predictions change`,
            errorDetail(err),
          ),
        );
      }
    }
    // Unsubscribe tickers no longer in predictions
    for (const ticker of Object.keys(this.subscriptions)) {
      if (!newTickers.includes(ticker)) {
        this.unsubscribeTicker(ticker);
      }
    }
    // Update in-memory list
    this.predictions = newPreds;
  }

  private unsubscribeTicker(ticker: string): void {
    const unsub = this.subscriptions[ticker];
    if (unsub) unsub();
    delete this.subscriptions[ticker];
  }

  private async handlePrice(ticker: string, price: number) {
    if (this.inProgress[ticker]) return;
    this.inProgress[ticker] = true;
    try {
      const recIndex = this.predictions.findIndex((r) => r.ticker === ticker);
      if (recIndex === -1) return;
      const rec = this.predictions[recIndex];
      const filters = this.symbolFilters[ticker];
      if (!filters) {
        this.logger.warn(
          `No exchange filters cached for ${ticker}; skipping price update`,
        );
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
        const order = await client.order({
          symbol: ticker,
          side: 'BUY',
          type: OrderType.MARKET,
          quantity: qty.toFixed(),
        });
        const boughtQty = D(order.executedQty || qty.toFixed());
        const cost = D(order.cummulativeQuoteQty || '0');
        const avgPrice = boughtQty.gt(0) ? cost.div(boughtQty) : D(price);
        // Update record
        rec.executed = true;
        rec.executedQty = boughtQty.toNumber();
        rec.entryExecutedPrice = avgPrice.toNumber();
        await this.predictionLoggerService.persistPredictions(this.predictions);
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
            await client.order({
              symbol: ticker,
              side: 'SELL',
              type: OrderType.LIMIT,
              timeInForce: TimeInForce.GTC,
              quantity: qty.toFixed(),
              price: limitPrice.toFixed(),
            });
          } catch (err: unknown) {
            // If no balance, remove prediction and unsubscribe to stop retries
            if (
              (err as { code?: number }).code === BINANCE_INSUFFICIENT_BALANCE
            ) {
              this.logger.warn(
                `Insufficient balance for ${ticker}, removing pending sell and unsubscribing`,
              );
              this.predictions.splice(recIndex, 1);
              await this.predictionLoggerService.persistPredictions(
                this.predictions,
              );
              this.unsubscribeTicker(ticker);
              return;
            }
            throw err;
          }
          // Log to orders file
          const profit = limitPrice.minus(rec.entryExecutedPrice).mul(qty);
          await this.predictionLoggerService.persistOrderLog({
            ticker,
            signalTime: rec.timestamp,
            buyPrice: rec.entryExecutedPrice,
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
              profit.toNumber(),
            );
          } catch (err: unknown) {
            this.logger.error(
              `Failed to label signal for ${rec.ticker} @ ${rec.timestamp}`,
              errorDetail(err),
            );
          }
          // Remove prediction and unsubscribe
          this.predictions.splice(recIndex, 1);
          await this.predictionLoggerService.persistPredictions(
            this.predictions,
          );
          this.unsubscribeTicker(ticker);
        }
      }
    } finally {
      delete this.inProgress[ticker];
    }
  }
}
