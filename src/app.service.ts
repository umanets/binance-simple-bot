import { Injectable } from '@nestjs/common';
import { Order } from 'binance-api-node';
import { TWAlertDto } from './request';
import { TradeLogEntry, TradeLoggerService } from './data-services/trade-logger.service';
import { GhostTradeService } from './data-services/ghost-trade.service';
import { SignalLoggerService, SignalLogEntry } from './data-services/signal-logger.service';
import { PredictionService } from './prediction.service';
import { CandleChartInterval } from 'binance-api-node';

import * as binance from './binance';

const BINANCE_FEE = 0.001;
// Parameters for dynamic k calculation (weights, thresholds, min/max)
const DYNAMIC_K_PARAMS = {
  atrThreshold: 0.02,
  stdevThreshold: 0.03,
  volRatioThreshold: 1.0,
  wAtr: 0.3,
  wStdev: 0.3,
  wVol: 0.2,
  wRel: 0.2,
  minK: 0.05,
  maxK: 1.0,
};

@Injectable()
export class AppService {
  constructor(
    private readonly tradeLogger: TradeLoggerService,
    private readonly ghostService: GhostTradeService,
    private readonly signalLogger: SignalLoggerService,
    private readonly predictionService: PredictionService,
  ) {}

  async buyLot(request: TWAlertDto): Promise<Order | undefined> {
    try {
      const trades = (await this.tradeLogger.getAllTrades()).filter(
        (t) => t.ticker === request.ticker,
      );
      const tradeCount = trades.length;
      // Compute shrinked Fibonacci-based threshold using ghost buy/sell pairs
      const ghostBuys = (await this.ghostService.getGhostBuyTrades()).filter(
        (g) => g.ticker === request.ticker,
      ).length;
      const ghostSells = (await this.ghostService.getGhostSellTrades()).filter(
        (g) => g.ticker === request.ticker,
      ).length;
      const ghostPairsCount = Math.min(ghostBuys, ghostSells);
      // dynamic shrink coefficient based on incoming metrics
      const k = this.calcK(request);
      const a = Math.max(0, ghostPairsCount - tradeCount);
      const initialFib = this.fibonacci(tradeCount);
      const fibN = initialFib / (1 + k * a);
      const nextStepCoef = 1 - fibN * 0.01;
      // Prepare base log entry for this signal
      const logEntry: SignalLogEntry = {
        timestamp: new Date().toISOString(),
        ticker: request.ticker,
        direction: request.direction,
        price: request.price,
        buyCoef: request.buyCoef,
        sellCoef: request.sellCoef,
        atr: request.atr,
        stdev: request.stdev,
        volRatio: request.volRatio,
        reliability: request.reliability,
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
      const sumQty = trades.reduce((sum, t) => sum + t.qty, 0);
      const sumPriceQty = trades.reduce((sum, t) => sum + t.price * t.qty, 0);
      const oldAvgPrice = sumQty > 0 ? sumPriceQty / sumQty : 0;
      const marketPrice = await binance.get_price(request.ticker);

      // compute per-symbol USDT allocation (static divisor=15)
      const totalUSDT = await binance.totalBalanceUSDT();
      const freeUSDT = await binance.freeBalanceUSDT();
      const divisor = 30; // todo: can be reduced to 15 after tests
      const perCoinUSDT = totalUSDT / divisor;
      // base quantity in asset terms
      const baseQty = perCoinUSDT / marketPrice;
      // ensure we meet minimum lot size
      const stepSize = await binance.step(request.ticker);
      let adjBaseQty = baseQty;
      if (adjBaseQty < stepSize) adjBaseQty = stepSize;
      // dynamic sizing: direct-linear based solely on buyCoef (0..64)
      const maxCoef = 64;
      let uBuy = request.buyCoef / maxCoef;
      uBuy = Math.max(0, Math.min(1, uBuy));
      const factor = 1 + uBuy;  // factor in [1..2]
      // size factor by magnitude
      const [LP, GP] = this.calcLocalGlobalPower(request)
      const sizeFactor = (LP + GP + 2) / 2
      let buyQty = adjBaseQty * factor * sizeFactor;
      console.log("=================");
      console.log(`LP: ${LP}, GP: ${GP}`)
      console.log(`LP_GP SIZE FACTOR: ${sizeFactor}`)
      console.log(`LOT SIZE IN QUOTED: ${buyQty * marketPrice}`)
      console.log("=================")
      // raw buy quantity
      
      if (buyQty < stepSize) buyQty = stepSize;
      // ensure sufficient funds; abort if not
      const requiredUSDT = buyQty * marketPrice;
      if (requiredUSDT > freeUSDT) {
        console.log(
          `Buy aborted: insufficient USDT (need ${requiredUSDT.toFixed(2)}, have ${freeUSDT.toFixed(2)})`
        );
        return undefined;
      }
      const buyPrice = marketPrice;
      const newSumQty = sumQty + buyQty;
      const newSumPriceQty = sumPriceQty + buyPrice * buyQty;
      const newAvgPrice = newSumQty > 0 ? newSumPriceQty / newSumQty : buyPrice;

      if (sumQty > 0 && newAvgPrice > oldAvgPrice * nextStepCoef) {
        console.log(
          `Buy rejected: new average price (${newAvgPrice.toFixed(8)}) is not at least ${(100 - nextStepCoef * 100).toFixed(1)}% lower than previous average (${oldAvgPrice.toFixed(8)})`,
        );
        // On ghost buy: fetch recent candles and log full context
        // On ghost buy: fetch recent candles, log full context and request LLM prediction
        logEntry.candles = await binance.getCandles(request.ticker, CandleChartInterval.ONE_MINUTE, 720);
        await this.signalLogger.appendSignal(logEntry);
        await this.predictionService.predict(logEntry);
        // Record ghost buy
        await this.ghostService.addGhostBuyTrade({ ticker: request.ticker, price: buyPrice });
        return undefined;
      }

      const qtyNormalized = await this.normalizeToStep(
        buyQty,
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
      // On real purchase, clear ghost records and log success
      await this.ghostService.removeTradesByTicker(request.ticker);
      return order;
    } catch (e) {
      console.log('Error: ' + e);
    }
  }

  async sellLot(request: TWAlertDto): Promise<Order | undefined> {
    // Compute signal context for logging
    const allTrades = await this.tradeLogger.getAllTrades();
    const tradesForTicker = allTrades.filter(t => t.ticker === request.ticker);
    const tradeCount = tradesForTicker.length;
    const ghostBuys = (await this.ghostService.getGhostBuyTrades()).filter(g => g.ticker === request.ticker).length;
    const ghostSells = (await this.ghostService.getGhostSellTrades()).filter(g => g.ticker === request.ticker).length;
    const ghostPairsCount = Math.min(ghostBuys, ghostSells);
    const k = this.calcK(request);
    const a = Math.max(0, ghostPairsCount - tradeCount);
    const initialFib = this.fibonacci(tradeCount);
    const fibN = initialFib / (1 + k * a);
    const nextStepCoef = 1 - fibN * 0.01;
    // Prepare base log entry
    const logEntry: SignalLogEntry = {
      timestamp: new Date().toISOString(),
      ticker: request.ticker,
      direction: request.direction,
      price: request.price,
      buyCoef: request.buyCoef,
      sellCoef: request.sellCoef,
      atr: request.atr,
      stdev: request.stdev,
      volRatio: request.volRatio,
      reliability: request.reliability,
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
      // On ghost sell: fetch recent candles and log full context
      // On ghost sell: fetch recent candles, log context and request LLM prediction
      logEntry.candles = await binance.getCandles(request.ticker, CandleChartInterval.ONE_MINUTE, 720);
      // Record ghost sell
      await this.ghostService.addGhostSellTrade({ ticker: request.ticker, price: currentPrice });
      return;
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
    // dynamic sizing: direct-linear based solely on sellCoef (0..64)
    const maxCoef = 64;
    let uSell = request.sellCoef / maxCoef;
    uSell = Math.max(0, Math.min(1, uSell));
    const sellFactor = 1 + uSell;  // factor in [1..2]
    const sellQty = Math.min(qty * sellFactor, allQty);
    if (sellQty > 0) {
      const qtyNorm = await this.normalizeToStep(sellQty, request.ticker);
      try {
        const order = await binance.sell(request.ticker, qtyNorm, currentPrice);
        // Partial‐sell: remove only the consumed portions of the selected trades, keep leftovers
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
            // partially consume this trade entry
            consumed.push(t);
            const leftoverQty = t.qty - remainingToSell;
            leftovers.push({ ticker: t.ticker, qty: leftoverQty, price: t.price, time: t.time });
            remainingToSell = 0;
            break;
          }
        }
        // remove fully (or partially) consumed original entries
        await this.tradeLogger.removeTrades(consumed);
        // re-append any leftover qty from a partially consumed trade (with dust-cleanup)
        for (const lf of leftovers) {
          if (lf.qty >= step) {
            await this.tradeLogger.appendTrade(lf);
          } else {
            console.log(
              `[Dust cleanup] Dropped leftover ${lf.qty} of ${request.ticker} since it's below step ${step}`
            );
          }
        }
        console.log(
          'Limit sell order placed at',
          currentPrice,
          'sold:', soldQty,
          're-stored leftovers:', leftovers.map(l => l.qty)
        );
        // On real sale, clear ghost records and log success
        await this.ghostService.removeTradesByTicker(request.ticker);
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

  // Fibonacci sequence generator matching 1,2,3,5,... for n >= 1
  private fibonacci(n: number): number {
    if (n <= 0) return 0;
    if (n === 1) return 1;
    let a = 1;
    let b = 2;
    for (let i = 3; i <= n; i++) {
      const c = a + b;
      a = b;
      b = c;
    }
    return b;
  }
  
  // Calculate dynamic shrink coefficient k based on alert metrics
  public calcK(request: TWAlertDto): number {
    const { atr, stdev, volRatio, reliability } = request;
    const p = DYNAMIC_K_PARAMS;
    // Normalize metrics
    const atrN   = Math.min(atr   / p.atrThreshold, 1);
    const stdevN = Math.min(stdev / p.stdevThreshold, 1);
    // Inverse of volRatio beyond 1 -> higher liquidity lowers k
    const volInv = 1 - Math.min((volRatio - 1) / p.volRatioThreshold, 1);
    // Inverse of reliability -> higher reliability lowers k
    const relInv = 1 - reliability;
    // Weighted sum
    let rawK = p.wAtr * atrN + p.wStdev * stdevN + p.wVol * volInv + p.wRel * relInv;
    // Clamp to [minK, maxK]
    rawK = Math.max(p.minK, Math.min(rawK, p.maxK));
    return rawK;
  }
  
  /**
   * Calculate magnetic power magnitude based on multi-timeframe EMA bands.
   * Assumes request contains tfDir, tfUpperVal, tfLowerVal, ... tf5Dir, tf5UpperVal, tf5LowerVal.
   * Returns a normalized magnitude in [0..1].
   */
  public calcMagneticPower(request: TWAlertDto): number {
    const price = request.price;
    const weights = [1, 2, 3, 4, 5, 6];
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const dirs = [
      request.tfDir,
      request.tf1Dir,
      request.tf2Dir,
      request.tf3Dir,
      request.tf4Dir,
      request.tf5Dir,
    ];
    const uppers = [
      request.tfUpperVal,
      request.tf1UpperVal,
      request.tf2UpperVal,
      request.tf3UpperVal,
      request.tf4UpperVal,
      request.tf5UpperVal,
    ];
    const lowers = [
      request.tfLowerVal,
      request.tf1LowerVal,
      request.tf2LowerVal,
      request.tf3LowerVal,
      request.tf4LowerVal,
      request.tf5LowerVal,
    ];
    let weightedSum = 0;
    for (let i = 0; i < weights.length; i++) {
      const dirStr = dirs[i] || '';
      // Handle inner-band cases: isInnerUp (0→1), isInnerDown (0→-1), legacy isInner (-1→+1)
      if (dirStr.startsWith('isInner')) {
        const lower = lowers[i], upper = uppers[i];
        const denom = upper - lower;
        if (denom > 0) {
          let pNorm = (price - lower) / denom;
          pNorm = Math.max(0, Math.min(pNorm, 1));
          let pScaled = 0;
          if (dirStr === 'isInnerUp') {
            pScaled = pNorm;
          } else if (dirStr === 'isInnerDown') {
            pScaled = -pNorm;
          } else {
            pScaled = pNorm * 2 - 1;
          }
          weightedSum += weights[i] * pScaled;
        }
        continue;
      }
      // Determine directional sign
      let dir = 0;
      if (dirStr === 'isUp') dir = 1;
      else if (dirStr === 'isDown') dir = -1;
      else {
        const s = dirStr.toLowerCase();
        if (s.includes('up')) dir = 1;
        else if (s.includes('down')) dir = -1;
      }
      if (dir === 0) continue;
      // Proximity factor inside the band [0..1]
      const lower = lowers[i], upper = uppers[i];
      const denom = upper - lower;
      let p = 0;
      if (denom > 0) {
        p = (price - lower) / denom;
        p = Math.max(0, Math.min(p, 1));
      }
      weightedSum += weights[i] * dir * p;
    }
    return weightSum > 0 ? weightedSum / weightSum : 0;
  }
  
  /**
   * Compute separate local and global magnetic powers.
   * Local: first three TFs (1m,5m,15m) weights [1,2,3].
   * Global: last three TFs (1h,4h,1d) weights [3,5,8].
   * Returns tuple [localPower, globalPower] in [-1..1].
   */
  public calcLocalGlobalPower(request: TWAlertDto): [number, number] {
    const price = request.price;
    const dirs = [
      request.tfDir, request.tf1Dir, request.tf2Dir,
      request.tf3Dir, request.tf4Dir, request.tf5Dir
    ];
    const uppers = [
      request.tfUpperVal, request.tf1UpperVal, request.tf2UpperVal,
      request.tf3UpperVal, request.tf4UpperVal, request.tf5UpperVal
    ];
    const lowers = [
      request.tfLowerVal, request.tf1LowerVal, request.tf2LowerVal,
      request.tf3LowerVal, request.tf4LowerVal, request.tf5LowerVal
    ];
    const lokW = [1, 2, 3];
    const globW = [3, 5, 8];
    const sumLok = lokW.reduce((a, b) => a + b, 0);
    const sumGlob = globW.reduce((a, b) => a + b, 0);
    let wLok = 0;
    let wGlob = 0;
    // local (indices 0..2)
    for (let i = 0; i < lokW.length; i++) {
      const w = lokW[i];
      const dirStr = dirs[i] || '';
      if (dirStr.startsWith('isInner')) {
        const lower = lowers[i], upper = uppers[i], d = upper - lower;
        if (d > 0) {
          let pNorm = (price - lower) / d;
          pNorm = Math.max(0, Math.min(1, pNorm));
          let pScaled = 0;
          if (dirStr === 'isInnerUp') {
            pScaled = pNorm;
          } else if (dirStr === 'isInnerDown') {
            pScaled = -pNorm;
          } else {
            pScaled = pNorm * 2 - 1;
          }
          wLok += w * pScaled;
        }
      } else {
        let dir = 0;
        const s = dirStr.toLowerCase();
        if (dirStr === 'isUp' || s.includes('up')) dir = 1;
        else if (dirStr === 'isDown' || s.includes('down')) dir = -1;
        if (dir !== 0) {
          const lower = lowers[i], upper = uppers[i], d = upper - lower;
          let p = 0;
          if (d > 0) {
            p = (price - lower) / d;
            p = Math.max(0, Math.min(1, p));
          }
          wLok += w * dir * p;
        }
      }
    }
    // global (indices 3..5)
    for (let j = 0; j < globW.length; j++) {
      const w = globW[j];
      const idx = j + 3;
      const dirStr = dirs[idx] || '';
      if (dirStr.startsWith('isInner')) {
        const lower = lowers[idx], upper = uppers[idx], d = upper - lower;
        if (d > 0) {
          let pNorm = (price - lower) / d;
          pNorm = Math.max(0, Math.min(1, pNorm));
          let pScaled = 0;
          if (dirStr === 'isInnerUp') {
            pScaled = pNorm;
          } else if (dirStr === 'isInnerDown') {
            pScaled = -pNorm;
          } else {
            pScaled = pNorm * 2 - 1;
          }
          wGlob += w * pScaled;
        }
      } else {
        let dir = 0;
        const s = dirStr.toLowerCase();
        if (dirStr === 'isUp' || s.includes('up')) dir = 1;
        else if (dirStr === 'isDown' || s.includes('down')) dir = -1;
        if (dir !== 0) {
          const lower = lowers[idx], upper = uppers[idx], d = upper - lower;
          let p = 0;
          if (d > 0) {
            p = (price - lower) / d;
            p = Math.max(0, Math.min(1, p));
          }
          wGlob += w * dir * p;
        }
      }
    }
    const local = sumLok > 0 ? wLok / sumLok : 0;
    const global = sumGlob > 0 ? wGlob / sumGlob : 0;
    return [Math.max(-1, Math.min(1, local)), Math.max(-1, Math.min(1, global))];
  }
}
