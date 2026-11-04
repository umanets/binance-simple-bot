// Mock the binance module so importing the service never builds real clients
jest.mock('./binance', () => ({
  getPrice: jest.fn(),
  buy: jest.fn(),
  sell: jest.fn(),
  lotStep: jest.fn(),
  baseCurrencyBalance: jest.fn(),
  totalBalanceUSDT: jest.fn(),
  freeBalanceUSDT: jest.fn(),
  getCandles: jest.fn(),
}));

import { findSellableTrades } from './spot-trade.service';
import { TradeLogEntry } from './data-services/trade-logger.service';

function trade(qty: number, price: number): TradeLogEntry {
  return { ticker: 'FOO', qty, price, time: '2026-01-01T00:00:00.000Z' };
}

describe('findSellableTrades', () => {
  it('selects trades while the running average clears break-even', () => {
    const trades = [trade(1, 100), trade(1, 102)];
    // Break-even for avg 100 with 0.1% fees ~ 100.22; price 103 clears both lots
    const { selectedTrades, sumQty } = findSellableTrades(trades, 103);
    expect(selectedTrades).toHaveLength(2);
    expect(sumQty).toBe(2);
  });

  it('stops at the first trade that would push the average under water', () => {
    const trades = [trade(1, 100), trade(1, 120)];
    // Price 105 clears the first lot but not the 110 average of both
    const { selectedTrades, sumQty } = findSellableTrades(trades, 105);
    expect(selectedTrades).toHaveLength(1);
    expect(sumQty).toBe(1);
  });

  it('selects nothing when the market is below break-even', () => {
    const trades = [trade(1, 100)];
    const { selectedTrades, sumQty } = findSellableTrades(trades, 100);
    expect(selectedTrades).toHaveLength(0);
    expect(sumQty).toBe(0);
  });

  it('handles an empty trade list', () => {
    expect(findSellableTrades([], 100)).toEqual({
      selectedTrades: [],
      sumQty: 0,
    });
  });
});
