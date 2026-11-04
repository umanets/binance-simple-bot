// Mock the binance module so importing the service never builds real clients
jest.mock('./binance', () => ({
  getPrice: jest.fn(),
  marketBuy: jest.fn(),
  limitSell: jest.fn(),
  lotStep: jest.fn(),
  baseCurrencyBalance: jest.fn(),
  totalBalanceUSDT: jest.fn(),
  freeBalanceUSDT: jest.fn(),
  getCandles: jest.fn(),
}));

import * as binance from './binance';
import { findSellableTrades, SpotTradeService } from './spot-trade.service';
import { TradeLogEntry } from './data-services/trade-logger.service';
import { TWAlertDto } from './request';

const mocked = binance as jest.Mocked<typeof binance>;

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

describe('SpotTradeService trading flows', () => {
  let service: SpotTradeService;
  let tradeLogger: {
    getAllTrades: jest.Mock;
    appendTrade: jest.Mock;
    removeTrades: jest.Mock;
  };
  let ghostService: {
    getGhostBuyTrades: jest.Mock;
    getGhostSellTrades: jest.Mock;
    addGhostBuyTrade: jest.Mock;
    addGhostSellTrade: jest.Mock;
    removeTradesByTicker: jest.Mock;
  };
  let signalLogger: { appendSignal: jest.Mock };
  let predictionService: { predict: jest.Mock };

  function alert(overrides: Partial<TWAlertDto> = {}): TWAlertDto {
    return {
      ticker: 'FOOUSDT',
      direction: 'aBuy',
      price: 100,
      buyCoef: 0,
      sellCoef: 0,
      ...overrides,
    } as TWAlertDto;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    tradeLogger = {
      getAllTrades: jest.fn().mockResolvedValue([]),
      appendTrade: jest.fn().mockResolvedValue(undefined),
      removeTrades: jest.fn().mockResolvedValue(undefined),
    };
    ghostService = {
      getGhostBuyTrades: jest.fn().mockResolvedValue([]),
      getGhostSellTrades: jest.fn().mockResolvedValue([]),
      addGhostBuyTrade: jest.fn().mockResolvedValue(undefined),
      addGhostSellTrade: jest.fn().mockResolvedValue(undefined),
      removeTradesByTicker: jest.fn().mockResolvedValue(undefined),
    };
    signalLogger = { appendSignal: jest.fn().mockResolvedValue(undefined) };
    predictionService = { predict: jest.fn().mockResolvedValue(undefined) };
    service = new SpotTradeService(
      tradeLogger as never,
      ghostService as never,
      signalLogger as never,
      predictionService as never,
    );
    (mocked.getPrice as jest.Mock).mockResolvedValue(100);
    (mocked.lotStep as jest.Mock).mockResolvedValue(0.001);
    (mocked.totalBalanceUSDT as jest.Mock).mockResolvedValue(3000);
    (mocked.freeBalanceUSDT as jest.Mock).mockResolvedValue(1000);
    (mocked.getCandles as jest.Mock).mockResolvedValue([]);
  });

  it('buys a first lot, logs the trade, and clears ghost records', async () => {
    (mocked.marketBuy as jest.Mock).mockResolvedValue({
      executedQty: '1.000',
      cummulativeQuoteQty: '100',
      fills: [{ price: '100' }],
    });

    const order = await service.buyLot(alert());

    expect(order).toBeDefined();
    expect(mocked.marketBuy).toHaveBeenCalledWith('FOOUSDT', 1);
    expect(tradeLogger.appendTrade).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: 'FOOUSDT', qty: 1, price: 100 }),
    );
    expect(ghostService.removeTradesByTicker).toHaveBeenCalledWith('FOOUSDT');
  });

  it('aborts the buy without ordering when free USDT is insufficient', async () => {
    (mocked.freeBalanceUSDT as jest.Mock).mockResolvedValue(1);

    const order = await service.buyLot(alert());

    expect(order).toBeUndefined();
    expect(mocked.marketBuy).not.toHaveBeenCalled();
  });

  it('records a ghost buy with signal + prediction when the average-price threshold fails', async () => {
    // One existing lot at 100; buying again at 100 cannot lower the average
    tradeLogger.getAllTrades.mockResolvedValue([trade(1, 100)]);

    const order = await service.buyLot(alert({ ticker: 'FOO' }));

    expect(order).toBeUndefined();
    expect(mocked.marketBuy).not.toHaveBeenCalled();
    expect(signalLogger.appendSignal).toHaveBeenCalled();
    expect(predictionService.predict).toHaveBeenCalled();
    expect(ghostService.addGhostBuyTrade).toHaveBeenCalledWith({
      ticker: 'FOO',
      price: 100,
    });
  });

  it('propagates exchange errors instead of swallowing them', async () => {
    (mocked.marketBuy as jest.Mock).mockRejectedValue(
      new Error('exchange down'),
    );

    await expect(service.buyLot(alert())).rejects.toThrow('exchange down');
  });

  it('records a ghost sell with signal context when nothing clears break-even', async () => {
    tradeLogger.getAllTrades.mockResolvedValue([trade(1, 100)]);
    (mocked.getPrice as jest.Mock).mockResolvedValue(99);

    const order = await service.sellLot(
      alert({ ticker: 'FOO', direction: 'aSell' }),
    );

    expect(order).toBeUndefined();
    expect(mocked.limitSell).not.toHaveBeenCalled();
    expect(signalLogger.appendSignal).toHaveBeenCalled();
    expect(ghostService.addGhostSellTrade).toHaveBeenCalledWith({
      ticker: 'FOO',
      price: 99,
    });
  });

  it('sells profitable lots and removes the consumed trade log entries', async () => {
    tradeLogger.getAllTrades.mockResolvedValue([trade(1, 100)]);
    (mocked.getPrice as jest.Mock).mockResolvedValue(110);
    (mocked.baseCurrencyBalance as jest.Mock).mockResolvedValue(1);
    (mocked.limitSell as jest.Mock).mockResolvedValue({ orderId: 7 });

    const order = await service.sellLot(
      alert({ ticker: 'FOO', direction: 'aSell' }),
    );

    expect(order).toEqual({ orderId: 7 });
    expect(mocked.limitSell).toHaveBeenCalledWith('FOO', 1, 110);
    expect(tradeLogger.removeTrades).toHaveBeenCalledWith([trade(1, 100)]);
    expect(ghostService.removeTradesByTicker).toHaveBeenCalledWith('FOO');
  });
});
