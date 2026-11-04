import { Injectable, Logger } from '@nestjs/common';
import { PositionRiskResult } from 'binance-api-node';
import { TWAlertDto } from './request';
import { D, floorToStep } from './money';
import * as binance from './binance';

type PositionSide = 'LONG' | 'SHORT';

/** Fibonacci buckets used to widen the re-entry threshold as a position grows. */
const FIB_BUCKETS = [1, 2, 3, 5, 8, 13, 21, 34];
/** Positions worth less than this (USDT) are treated as dust/not opened. */
const MIN_OPEN_NOTIONAL = 10;
/** Divisor converting the signal coefficient into a per-lot deposit share. */
const LOT_COEF_DIVISOR = 600;

function opposite(side: PositionSide): PositionSide {
  return side === 'LONG' ? 'SHORT' : 'LONG';
}

function amount(p: PositionRiskResult): number {
  return parseFloat(p.positionAmt);
}

function sumPnl(positions: PositionRiskResult[]): number {
  return positions.reduce((sum, p) => sum + parseFloat(p.unRealizedProfit), 0);
}

function sumNotional(positions: PositionRiskResult[]): number {
  return positions.reduce(
    (sum, p) => sum + Math.abs(amount(p)) * parseFloat(p.entryPrice),
    0,
  );
}

function positionsOnSide(
  positions: PositionRiskResult[],
  ticker: string,
  side: PositionSide,
): PositionRiskResult[] {
  return positions.filter(
    (p) =>
      p.symbol === ticker && (side === 'LONG' ? amount(p) > 0 : amount(p) < 0),
  );
}

/**
 * Signal-driven USDT-M futures executor (hedge mode).
 *
 * For each signal it, in order: (1) resets the whole symbol position when
 * total PnL reaches the threshold share of the deposit, (2) takes profit on
 * the counter side and uses half of it to reduce the losing signal side,
 * (3) skips re-entry until price has moved a Fibonacci-bucketed percentage
 * away from the average entry, and otherwise (4) opens a new market lot.
 *
 * No stop-loss or take-profit orders are placed; exits happen only through
 * the PnL reset and profit-taking rules above.
 */
@Injectable()
export class FuturesTradeService {
  private readonly logger = new Logger(FuturesTradeService.name);

  /** Handle an fBuy signal: manage and extend the LONG side. */
  async openLong(
    request: TWAlertDto,
    pnlExecutionThreshold = 0.01,
  ): Promise<void> {
    return this.execute('LONG', request, pnlExecutionThreshold);
  }

  /** Handle an fSell signal: manage and extend the SHORT side. */
  async openShort(
    request: TWAlertDto,
    pnlExecutionThreshold = 0.01,
  ): Promise<void> {
    return this.execute('SHORT', request, pnlExecutionThreshold);
  }

  private async execute(
    side: PositionSide,
    request: TWAlertDto,
    pnlExecutionThreshold: number,
  ): Promise<void> {
    const ticker = request.ticker;
    const currentPrice = await binance.getPrice(ticker);
    const positions = await binance.futuresPositionRisk();
    // Use futures wallet balance as deposit size (fallback to SIZE_OF_DEPO env)
    const walletBalance = await binance.futuresBalanceUSDT();
    const depoSize =
      walletBalance > 0
        ? walletBalance
        : Number(process.env.SIZE_OF_DEPO) || 100;

    // 1. Reset the symbol when total PnL reaches the threshold share of deposit
    const symbolPositions = positions.filter(
      (p) => p.symbol === ticker && amount(p) !== 0,
    );
    const totalPnl = sumPnl(symbolPositions);
    if (totalPnl > 0 && totalPnl >= depoSize * pnlExecutionThreshold) {
      this.logger.log(
        `PnL ${totalPnl.toFixed(2)} >= ${(depoSize * pnlExecutionThreshold).toFixed(2)}, resetting position for ${ticker}`,
      );
      await this.closePositions(symbolPositions, ticker);
      const qtyNew = await this.normalizeToFuturesStep(
        this.entryQty(side, request, depoSize),
        ticker,
      );
      await this.placeMarketOrder(ticker, side, qtyNew, 'open');
      return;
    }

    // 2. Take profit on the counter side, then spend half of it reducing
    //    losing positions on the signal side
    const counterPositions = positionsOnSide(positions, ticker, opposite(side));
    const counterPnl = sumPnl(counterPositions);
    const counterNotional = sumNotional(counterPositions);
    if (
      counterNotional > 0 &&
      counterPnl >= counterNotional * pnlExecutionThreshold
    ) {
      this.logger.log(
        `${opposite(side)}-only PnL ${counterPnl.toFixed(2)} >= ${(counterNotional * pnlExecutionThreshold).toFixed(2)}, ` +
          `closing ALL ${opposite(side)} positions for ${ticker}`,
      );
      await this.closePositions(counterPositions, ticker);
      await this.reduceLosingSide(
        side,
        positions,
        ticker,
        counterPnl / 2,
        depoSize,
        pnlExecutionThreshold,
        currentPrice,
      );
    }

    // 3. Skip re-entry until price has moved a Fibonacci-bucketed percentage
    //    away from the current average entry
    const opened = positionsOnSide(positions, ticker, side).find(
      (p) => Math.abs(amount(p)) * parseFloat(p.entryPrice) > MIN_OPEN_NOTIONAL,
    );
    if (opened) {
      const openedQty = Math.abs(amount(opened));
      const avgEntryPrice = parseFloat(opened.entryPrice);
      const lotCount =
        (openedQty * avgEntryPrice) / this.lotSizeUSDT(side, request, depoSize);
      const fibCount = FIB_BUCKETS.find((f) => f >= lotCount) ?? 34;
      const threshold =
        side === 'LONG'
          ? avgEntryPrice * (1 - fibCount / 100)
          : avgEntryPrice * (1 + fibCount / 100);
      const thresholdNotReached =
        side === 'LONG' ? currentPrice >= threshold : currentPrice <= threshold;
      if (thresholdNotReached) {
        this.logger.log(
          `Skipping ${side} entry for ${ticker} (${lotCount.toFixed(2)} lots): ` +
            `price ${currentPrice} has not ${side === 'LONG' ? 'dropped' : 'risen'} ` +
            `${fibCount}% from average entry ${avgEntryPrice} (threshold ${threshold.toFixed(8)})`,
        );
        return;
      }
    }

    // 4. Open a new market lot on the signal side
    const qty = await this.normalizeToFuturesStep(
      this.entryQty(side, request, depoSize),
      ticker,
    );
    if (qty > 0) {
      await this.placeMarketOrder(ticker, side, qty, 'open');
      this.logger.log(`Executed ${side} entry for ${ticker}`);
    } else {
      this.logger.warn(
        `Skipping ${side} entry for ${ticker}: computed quantity is ${qty}`,
      );
    }
  }

  /**
   * Lot size in USDT for one signal lot. Note the crossed coefficients:
   * LONG entries are sized by sellCoef and SHORT entries by buyCoef —
   * intentional, matching the semantics of the TradingView signal source.
   */
  private lotSizeUSDT(
    side: PositionSide,
    request: TWAlertDto,
    depoSize: number,
  ): number {
    const sizeCoef = side === 'LONG' ? request.sellCoef : request.buyCoef;
    return sizeCoef * (depoSize / LOT_COEF_DIVISOR);
  }

  private entryQty(
    side: PositionSide,
    request: TWAlertDto,
    depoSize: number,
  ): number {
    return this.lotSizeUSDT(side, request, depoSize) / request.price;
  }

  /** Close every given position with a reduce market order on its own side. */
  private async closePositions(
    positions: PositionRiskResult[],
    ticker: string,
  ): Promise<void> {
    for (const p of positions) {
      const amt = amount(p);
      const qtyClose = await this.normalizeToFuturesStep(Math.abs(amt), ticker);
      await this.placeMarketOrder(
        ticker,
        amt > 0 ? 'LONG' : 'SHORT',
        qtyClose,
        'close',
      );
    }
  }

  /**
   * Spend realized profit reducing losing positions on the given side,
   * closing the quantity whose loss equals the profit being spent.
   */
  private async reduceLosingSide(
    side: PositionSide,
    positions: PositionRiskResult[],
    ticker: string,
    profitToUse: number,
    depoSize: number,
    pnlExecutionThreshold: number,
    currentPrice: number,
  ): Promise<void> {
    const sidePositions = positionsOnSide(positions, ticker, side);
    const sidePnl = sumPnl(sidePositions);
    if (sidePnl >= 0 || Math.abs(sidePnl) <= depoSize * pnlExecutionThreshold) {
      return;
    }
    const totalQty = sidePositions.reduce(
      (sum, p) => sum + Math.abs(amount(p)),
      0,
    );
    const totalPriceQty = sumNotional(sidePositions);
    const avgEntry = totalQty > 0 ? totalPriceQty / totalQty : 0;
    // Negative when the side is underwater relative to its average entry
    const lossGap =
      side === 'LONG' ? currentPrice - avgEntry : avgEntry - currentPrice;
    if (lossGap >= 0) return;
    const qtyToClose = await this.normalizeToFuturesStep(
      Math.abs(profitToUse / lossGap),
      ticker,
    );
    if (qtyToClose <= 0) return;
    this.logger.log(
      `Rebalancing: closing ${side} ${qtyToClose.toFixed(8)} to realize ~${profitToUse.toFixed(2)} USDT profit`,
    );
    await this.placeMarketOrder(ticker, side, qtyToClose, 'close');
  }

  /**
   * Place a hedge-mode market order. `intent: 'open'` adds to the position
   * side, `intent: 'close'` reduces it (order side is inverted).
   */
  private async placeMarketOrder(
    ticker: string,
    positionSide: PositionSide,
    qty: number,
    intent: 'open' | 'close',
  ): Promise<void> {
    if (!Number.isFinite(qty) || qty <= 0) {
      this.logger.warn(
        `Skipping ${intent} ${positionSide} order for ${ticker}: computed quantity is ${qty}`,
      );
      return;
    }
    const openSide = positionSide === 'LONG' ? 'BUY' : 'SELL';
    const closeSide = positionSide === 'LONG' ? 'SELL' : 'BUY';
    await binance.futuresOrder({
      symbol: ticker,
      side: intent === 'open' ? openSide : closeSide,
      type: 'MARKET',
      quantity: qty.toFixed(8),
      positionSide,
    });
  }

  private async normalizeToFuturesStep(
    qty: number,
    ticker: string,
  ): Promise<number> {
    const step = await binance.futuresLotStep(ticker);
    return floorToStep(D(qty), step).toNumber();
  }
}
