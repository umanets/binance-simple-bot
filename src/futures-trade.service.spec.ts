// Mock the binance module used by FuturesTradeService
jest.mock('./binance', () => ({
  getPrice: jest.fn(),
  futuresPositionRisk: jest.fn(),
  futuresBalanceUSDT: jest.fn(),
  futuresLotStep: jest.fn(),
  futuresOrder: jest.fn(),
}));

import * as binance from './binance';
import { FuturesTradeService } from './futures-trade.service';
import { TWAlertDto } from './request';

const mocked = binance as jest.Mocked<typeof binance>;

function alert(overrides: Partial<TWAlertDto>): TWAlertDto {
  return {
    ticker: 'FOO',
    direction: 'fBuy',
    price: 60,
    buyCoef: 1,
    sellCoef: 1,
    ...overrides,
  } as TWAlertDto;
}

describe('FuturesTradeService openLong rebalancing logic', () => {
  let service: FuturesTradeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FuturesTradeService();
    // Small step so normalization preserves fractional quantities
    (mocked.futuresLotStep as jest.Mock).mockResolvedValue(0.00000001);
  });

  it('should rebalance longs when conditions met', async () => {
    (mocked.getPrice as jest.Mock).mockResolvedValue(50);
    // One short with profit, one long with sufficient loss
    (mocked.futuresPositionRisk as jest.Mock).mockResolvedValue([
      {
        symbol: 'FOO',
        positionAmt: '-2',
        entryPrice: '50',
        unRealizedProfit: '10',
      },
      {
        symbol: 'FOO',
        positionAmt: '5',
        entryPrice: '60',
        unRealizedProfit: '-20',
      },
    ]);
    (mocked.futuresBalanceUSDT as jest.Mock).mockResolvedValue(1000);
    (mocked.futuresOrder as jest.Mock).mockResolvedValue({});

    await service.openLong(alert({ direction: 'fBuy' }));

    // First call closes the short position
    expect(mocked.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO',
        side: 'BUY',
        type: 'MARKET',
        quantity: '2.00000000',
        positionSide: 'SHORT',
      }),
    );
    // Second call rebalances the long position
    expect(mocked.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO',
        side: 'SELL',
        type: 'MARKET',
        quantity: '0.50000000',
        positionSide: 'LONG',
      }),
    );
    // No additional calls (new entry purchase is skipped)
    expect((mocked.futuresOrder as jest.Mock).mock.calls.length).toBe(2);
  });

  it('should not rebalance when longPnl above threshold', async () => {
    (mocked.getPrice as jest.Mock).mockResolvedValue(50);
    (mocked.futuresPositionRisk as jest.Mock).mockResolvedValue([
      {
        symbol: 'FOO',
        positionAmt: '-2',
        entryPrice: '50',
        unRealizedProfit: '10',
      },
      {
        symbol: 'FOO',
        positionAmt: '5',
        entryPrice: '60',
        unRealizedProfit: '-5',
      },
    ]);
    (mocked.futuresBalanceUSDT as jest.Mock).mockResolvedValue(1000);
    (mocked.futuresOrder as jest.Mock).mockResolvedValue({});

    await service.openLong(alert({ direction: 'fBuy' }));

    // Only the short closure call, no rebalancing sell
    expect(mocked.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({ side: 'BUY', positionSide: 'SHORT' }),
    );
    expect((mocked.futuresOrder as jest.Mock).mock.calls.length).toBe(1);
    expect(mocked.futuresOrder).not.toHaveBeenCalledWith(
      expect.objectContaining({ side: 'SELL', positionSide: 'LONG' }),
    );
  });
});

describe('FuturesTradeService openShort rebalancing logic', () => {
  let service: FuturesTradeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FuturesTradeService();
    (mocked.futuresLotStep as jest.Mock).mockResolvedValue(0.00000001);
  });

  it('should rebalance shorts when conditions met', async () => {
    (mocked.getPrice as jest.Mock).mockResolvedValue(70);
    (mocked.futuresPositionRisk as jest.Mock).mockResolvedValue([
      {
        symbol: 'FOO',
        positionAmt: '2',
        entryPrice: '50',
        unRealizedProfit: '2',
      },
      {
        symbol: 'FOO',
        positionAmt: '-4',
        entryPrice: '60',
        unRealizedProfit: '-20',
      },
    ]);
    (mocked.futuresBalanceUSDT as jest.Mock).mockResolvedValue(1000);
    (mocked.futuresOrder as jest.Mock).mockResolvedValue({});

    await service.openShort(alert({ direction: 'fSell', price: 65 }));

    // First call closes the long position
    expect(mocked.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO',
        side: 'SELL',
        type: 'MARKET',
        quantity: '2.00000000',
        positionSide: 'LONG',
      }),
    );
    // Second call rebalances the short position
    expect(mocked.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO',
        side: 'BUY',
        type: 'MARKET',
        quantity: '0.10000000',
        positionSide: 'SHORT',
      }),
    );
    expect((mocked.futuresOrder as jest.Mock).mock.calls.length).toBe(2);
  });

  it('should not rebalance when short losses are below threshold', async () => {
    (mocked.getPrice as jest.Mock).mockResolvedValue(70);
    (mocked.futuresPositionRisk as jest.Mock).mockResolvedValue([
      {
        symbol: 'FOO',
        positionAmt: '2',
        entryPrice: '50',
        unRealizedProfit: '2',
      },
      {
        symbol: 'FOO',
        positionAmt: '-4',
        entryPrice: '60',
        unRealizedProfit: '-5',
      },
    ]);
    (mocked.futuresBalanceUSDT as jest.Mock).mockResolvedValue(1000);
    (mocked.futuresOrder as jest.Mock).mockResolvedValue({});

    await service.openShort(alert({ direction: 'fSell', price: 65 }));

    // Only the long closure call, no short rebalancing
    expect(mocked.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({ side: 'SELL', positionSide: 'LONG' }),
    );
    expect((mocked.futuresOrder as jest.Mock).mock.calls.length).toBe(1);
    expect(mocked.futuresOrder).not.toHaveBeenCalledWith(
      expect.objectContaining({ side: 'BUY', positionSide: 'SHORT' }),
    );
  });

  it('skips orders whose normalized quantity is zero', async () => {
    (mocked.getPrice as jest.Mock).mockResolvedValue(70);
    (mocked.futuresPositionRisk as jest.Mock).mockResolvedValue([]);
    (mocked.futuresBalanceUSDT as jest.Mock).mockResolvedValue(1000);
    // Step far larger than the computed entry quantity -> floors to zero
    (mocked.futuresLotStep as jest.Mock).mockResolvedValue(1000);
    (mocked.futuresOrder as jest.Mock).mockResolvedValue({});

    await service.openShort(alert({ direction: 'fSell', price: 65 }));

    expect(mocked.futuresOrder).not.toHaveBeenCalled();
  });
});
