import { Injectable } from '@nestjs/common';
import { Order } from 'binance-api-node';
import { TWAlertDto } from './request';
import { TradeLogEntry, TradeLoggerService } from './trade-logger.service';

import * as binance from './binance';

const BINANCE_FEE = 0.001;

@Injectable()
export class AppService {
  constructor(private readonly tradeLogger: TradeLoggerService) {}

  async buyLot(request: TWAlertDto): Promise<Order | undefined> {
    try {
      const trades = (await this.tradeLogger.getAllTrades()).filter(
        (t) => t.ticker === request.ticker,
      );
      const tradeCount = trades.length;
      const nextStepCoef = Math.max(1 - tradeCount * 0.01, 0.7);
      const sumQty = trades.reduce((sum, t) => sum + t.qty, 0);
      const sumPriceQty = trades.reduce((sum, t) => sum + t.price * t.qty, 0);
      const oldAvgPrice = sumQty > 0 ? sumPriceQty / sumQty : 0;
      const marketPrice = await binance.get_price(request.ticker);

      const buyQty = request.lotCount;
      const buyPrice = marketPrice;
      const newSumQty = sumQty + buyQty;
      const newSumPriceQty = sumPriceQty + buyPrice * buyQty;
      const newAvgPrice = newSumQty > 0 ? newSumPriceQty / newSumQty : buyPrice;

      if (sumQty > 0 && newAvgPrice > oldAvgPrice * nextStepCoef) {
        console.log(
          `Buy rejected: new average price (${newAvgPrice.toFixed(8)}) is not at least ${(100 - nextStepCoef * 100).toFixed(1)}% lower than previous average (${oldAvgPrice.toFixed(8)})`,
        );
        return undefined;
      }

      const qtyNormalized = await this.normalizeToStep(
        request.lotCount,
        request.ticker,
      );
      const order = await binance.buy(request.ticker, qtyNormalized);
      const qty = parseFloat(order.executedQty);
      const price = order.fills?.[0]?.price
        ? parseFloat(order.fills[0].price)
        : parseFloat(order.cummulativeQuoteQty) / qty;
      await this.tradeLogger.appendTrade({
        ticker: request.ticker,
        qty,
        price,
        time: new Date().toISOString(),
      });
      console.log(' === BOUGHT ONE ' + request.ticker + '=== ');
      return order;
    } catch (e) {
      console.log('Error: ' + e);
    }
  }

  async sellLot(request: TWAlertDto): Promise<Order | undefined> {
    const currentPrice = await binance.get_price(request.ticker);
    if (!currentPrice) {
      throw new Error('Unable to fetch current price.');
    }

    const trades = (await this.tradeLogger.getAllTrades()).filter(
      (t) => t.ticker === request.ticker,
    );

    if (!trades.length) {
      console.log('No trade log entries for this ticker.');
      return;
    }

    const { selectedTrades, sumQty } = this.findSellableTrades(
      trades,
      currentPrice,
    );
    if (selectedTrades.length == 0) {
      console.log('No eligible orders to sell');
    }
    const allQty = await binance.base_currency_balance(request.ticker);
    const step = await binance.step(request.ticker);

    // Defensive remove case (dust left)
    if (allQty < step && sumQty >= step) {
      const allTickerTrades = (await this.tradeLogger.getAllTrades()).filter(
        (t) => t.ticker === request.ticker,
      );
      await this.tradeLogger.removeTrades(allTickerTrades);
      console.log(
        `[Cleanup] Balance for ${request.ticker} less than step size. Cleared all log lots for ticker.`,
      );
      return;
    }

    const qty = allQty < sumQty ? allQty : sumQty;
    if (qty > 0) {
      const qtyNorm = await this.normalizeToStep(qty, request.ticker);
      try {
        const order = await binance.sell(request.ticker, qtyNorm, currentPrice);
        await this.tradeLogger.removeTrades(selectedTrades);
        console.log(
          'Limit sell order placed at',
          currentPrice,
          'and removed from logs',
        );
        return order;
      } catch (e) {
        console.log('Error placing limit order:', e);
        return;
      }
    }
    return;
  }

  private findSellableTrades(
    trades: TradeLogEntry[],
    marketPrice: number,
    feeRate = BINANCE_FEE,
  ): { selectedTrades: TradeLogEntry[]; sumQty: number } {
    let sumQty = 0;
    let sumPrice = 0;
    const selectedTrades: TradeLogEntry[] = [];
    for (const t of trades) {
      const nextSumQty = sumQty + t.qty;
      const nextSumPrice = sumPrice + t.price * t.qty;
      const avgPrice = nextSumQty ? nextSumPrice / nextSumQty : 0;
      // break-even
      const breakEven = avgPrice * (1 + 2 * feeRate) * 1.0002; // чуть-чуть запас
      if (marketPrice >= breakEven) {
        sumQty = nextSumQty;
        sumPrice = nextSumPrice;
        selectedTrades.push(t);
      } else {
        break;
      }
    }
    return {
      selectedTrades,
      sumQty,
    };
  }

  private async normalizeToStep(qty: number, ticker: string): Promise<number> {
    const step = await binance.step(ticker);
    return qty - (qty % step);
  }
}
