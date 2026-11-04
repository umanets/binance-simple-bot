import { Injectable, Logger } from '@nestjs/common';
import { CandleChartInterval, Order } from 'binance-api-node';
import { TWAlertDto } from './request';
import {
  TradeLogEntry,
  TradeLoggerService,
} from './data-services/trade-logger.service';
import { GhostTradeService } from './data-services/ghost-trade.service';
import {
  SignalLoggerService,
  SignalLogEntry,
} from './data-services/signal-logger.service';
import { PredictionService } from './prediction/prediction.service';
import { calcK, calcLocalGlobalPower, fibonacci } from './signal-math';
import { D, floorToStep } from './money';
import * as binance from './binance';

const BINANCE_FEE = 0.001;
// Fraction of total balance allocated per symbol (1/divisor).
const PER_COIN_DIVISOR = 30;
// Buy/sell coefficients arrive in the 0..64 range from the signal source.
const MAX_COEF = 64;

/**
 * Greedily select the oldest buy lots whose running average still clears
 * break-even (fees plus a small safety margin) at the given market price.
 */
export function findSellableTrades(
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
    // Break-even with both-side fees and a tiny safety margin
    const breakEven = avgPrice * (1 + 2 * feeRate) * 1.0002;
    if (marketPrice >= breakEven) {
      sumQty = nextSumQty;
      sumPrice = nextSumPrice;
      selectedTrades.push(t);
    } else {
      break;
    }
  }
  return { selectedTrades, sumQty };
}

@Injectable()
export class SpotTradeService {
  private readonly logger = new Logger(SpotTradeService.name);

  constructor(
    private readonly tradeLogger: TradeLoggerService,
    private readonly ghostService: GhostTradeService,
    private readonly signalLogger: SignalLoggerService,
    private readonly predictionService: PredictionService,
  ) {}

  async buyLot(request: TWAlertDto): Promise<Order | undefined> {
    const { logEntry, tradeContext } = await this.buildSignalContext(request);
    const { trades, nextStepCoef } = tradeContext;
    const sumQty = trades.reduce((sum, t) => sum + t.qty, 0);
    const sumPriceQty = trades.reduce((sum, t) => sum + t.price * t.qty, 0);
    const oldAvgPrice = sumQty > 0 ? sumPriceQty / sumQty : 0;
    const marketPrice = await binance.getPrice(request.ticker);

    const totalUSDT = await binance.totalBalanceUSDT();
    const freeUSDT = await binance.freeBalanceUSDT();
    const perCoinUSDT = totalUSDT / PER_COIN_DIVISOR;
    const baseQty = perCoinUSDT / marketPrice;
    const stepSize = await binance.lotStep(request.ticker);
    const adjBaseQty = Math.max(baseQty, stepSize);
    // Dynamic sizing: direct-linear on buyCoef, then scaled by band power
    const uBuy = Math.max(0, Math.min(1, (request.buyCoef ?? 0) / MAX_COEF));
    const factor = 1 + uBuy; // factor in [1..2]
    const [localPower, globalPower] = calcLocalGlobalPower(request);
    const sizeFactor = (localPower + globalPower + 2) / 2;
    const buyQty = Math.max(adjBaseQty * factor * sizeFactor, stepSize);
    this.logger.log(
      `Sizing ${request.ticker}: localPower=${localPower.toFixed(4)}, globalPower=${globalPower.toFixed(4)}, ` +
        `sizeFactor=${sizeFactor.toFixed(4)}, lotSizeUSDT=${(buyQty * marketPrice).toFixed(2)}`,
    );

    const requiredUSDT = buyQty * marketPrice;
    if (requiredUSDT > freeUSDT) {
      this.logger.warn(
        `Buy aborted: insufficient USDT (need ${requiredUSDT.toFixed(2)}, have ${freeUSDT.toFixed(2)})`,
      );
      return undefined;
    }

    const buyPrice = marketPrice;
    const newSumQty = sumQty + buyQty;
    const newSumPriceQty = sumPriceQty + buyPrice * buyQty;
    const newAvgPrice = newSumQty > 0 ? newSumPriceQty / newSumQty : buyPrice;

    if (sumQty > 0 && newAvgPrice > oldAvgPrice * nextStepCoef) {
      this.logger.log(
        `Buy rejected: new average price (${newAvgPrice.toFixed(8)}) is not at least ` +
          `${(100 - nextStepCoef * 100).toFixed(1)}% lower than previous average (${oldAvgPrice.toFixed(8)})`,
      );
      // Ghost buy: log full context with candles and request an LLM prediction
      logEntry.candles = await binance.getCandles(
        request.ticker,
        CandleChartInterval.ONE_MINUTE,
        360,
      );
      await this.signalLogger.appendSignal(logEntry);
      await this.predictionService.predict(logEntry);
      await this.ghostService.addGhostBuyTrade({
        ticker: request.ticker,
        price: buyPrice,
      });
      return undefined;
    }

    const qtyNormalized = await this.normalizeToStep(buyQty, request.ticker);
    const order = await binance.marketBuy(request.ticker, qtyNormalized);
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
    this.logger.log(`Bought one lot of ${request.ticker}`);
    // On real purchase, clear ghost records
    await this.ghostService.removeTradesByTicker(request.ticker);
    return order;
  }

  async sellLot(request: TWAlertDto): Promise<Order | undefined> {
    const { logEntry, tradeContext } = await this.buildSignalContext(request);
    const { trades } = tradeContext;
    const currentPrice = await binance.getPrice(request.ticker);

    if (!trades.length) {
      this.logger.log(`No trade log entries for ${request.ticker}.`);
      return undefined;
    }

    const { selectedTrades, sumQty } = findSellableTrades(trades, currentPrice);
    if (selectedTrades.length === 0) {
      this.logger.log(`No eligible orders to sell for ${request.ticker}`);
      // Ghost sell: log full context with candles and record the rejection
      logEntry.candles = await binance.getCandles(
        request.ticker,
        CandleChartInterval.ONE_MINUTE,
        720,
      );
      await this.signalLogger.appendSignal(logEntry);
      await this.ghostService.addGhostSellTrade({
        ticker: request.ticker,
        price: currentPrice,
      });
      return undefined;
    }

    const allQty = await binance.baseCurrencyBalance(request.ticker);
    const step = await binance.lotStep(request.ticker);

    // Defensive remove case (dust left)
    if (allQty < step && sumQty >= step) {
      await this.tradeLogger.removeTrades(trades);
      this.logger.log(
        `[Cleanup] Balance for ${request.ticker} less than step size. Cleared all log lots for ticker.`,
      );
      return undefined;
    }

    const qty = Math.min(allQty, sumQty);
    // Dynamic sizing: direct-linear on sellCoef (0..64)
    const uSell = Math.max(0, Math.min(1, (request.sellCoef ?? 0) / MAX_COEF));
    const sellFactor = 1 + uSell; // factor in [1..2]
    const sellQty = Math.min(qty * sellFactor, allQty);
    if (sellQty <= 0) {
      return undefined;
    }

    const qtyNorm = await this.normalizeToStep(sellQty, request.ticker);
    const order = await binance.limitSell(
      request.ticker,
      qtyNorm,
      currentPrice,
    );
    // Partial sell: remove only the consumed portions of the selected trades
    const soldQty = qtyNorm;
    let remainingToSell = soldQty;
    const consumed: TradeLogEntry[] = [];
    const leftovers: TradeLogEntry[] = [];
    for (const t of selectedTrades) {
      if (remainingToSell <= 0) break;
      if (t.qty <= remainingToSell) {
        consumed.push(t);
        remainingToSell -= t.qty;
      } else {
        // Partially consume this trade entry
        consumed.push(t);
        leftovers.push({
          ticker: t.ticker,
          qty: t.qty - remainingToSell,
          price: t.price,
          time: t.time,
        });
        remainingToSell = 0;
        break;
      }
    }
    await this.tradeLogger.removeTrades(consumed);
    // Re-append any leftover qty from a partially consumed trade (with dust cleanup)
    for (const lf of leftovers) {
      if (lf.qty >= step) {
        await this.tradeLogger.appendTrade(lf);
      } else {
        this.logger.log(
          `[Dust cleanup] Dropped leftover ${lf.qty} of ${request.ticker} since it's below step ${step}`,
        );
      }
    }
    this.logger.log(
      `Limit sell order placed at ${currentPrice}, sold: ${soldQty}, ` +
        `re-stored leftovers: ${JSON.stringify(leftovers.map((l) => l.qty))}`,
    );
    // On real sale, clear ghost records
    await this.ghostService.removeTradesByTicker(request.ticker);
    return order;
  }

  /**
   * Gather per-ticker trade/ghost statistics and assemble the signal log
   * entry shared by the buy and sell paths.
   */
  private async buildSignalContext(request: TWAlertDto): Promise<{
    logEntry: SignalLogEntry;
    tradeContext: { trades: TradeLogEntry[]; nextStepCoef: number };
  }> {
    const trades = (await this.tradeLogger.getAllTrades()).filter(
      (t) => t.ticker === request.ticker,
    );
    const tradeCount = trades.length;
    const ghostBuys = (await this.ghostService.getGhostBuyTrades()).filter(
      (g) => g.ticker === request.ticker,
    ).length;
    const ghostSells = (await this.ghostService.getGhostSellTrades()).filter(
      (g) => g.ticker === request.ticker,
    ).length;
    const ghostPairsCount = Math.min(ghostBuys, ghostSells);
    // Shrink the Fibonacci threshold based on ghost pairs beyond trade count
    const k = calcK(request);
    const a = Math.max(0, ghostPairsCount - tradeCount);
    const initialFib = fibonacci(tradeCount);
    const fibN = initialFib / (1 + k * a);
    const nextStepCoef = 1 - fibN * 0.01;
    const logEntry: SignalLogEntry = {
      timestamp: new Date().toISOString(),
      ticker: request.ticker,
      direction: request.direction,
      price: request.price,
      buyCoef: request.buyCoef ?? 0,
      sellCoef: request.sellCoef ?? 0,
      atr: request.atr ?? 0,
      stdev: request.stdev ?? 0,
      volRatio: request.volRatio ?? 1,
      reliability: request.reliability ?? 0,
      ghostBuys,
      ghostSells,
      ghostPairsCount,
      tradeCount,
      initialFib,
      a,
      k,
      fibN,
      nextStepCoef,
    };
    return { logEntry, tradeContext: { trades, nextStepCoef } };
  }

  private async normalizeToStep(qty: number, ticker: string): Promise<number> {
    const step = await binance.lotStep(ticker);
    return floorToStep(D(qty), step).toNumber();
  }
}
