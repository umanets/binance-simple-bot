// Mock the binance module used by AppService
jest.mock('./binance', () => ({
  get_price: jest.fn(),
  futuresPositionRisk: jest.fn(),
  futuresBalanceUSDT: jest.fn(),
  fstep: jest.fn(),
  futuresOrder: jest.fn(),
}));
// Use require to ensure the mocked module is loaded
const binance: jest.Mocked<typeof import('./binance')> = require('./binance');
const { AppService } = require('./app.service');
// TWAlertDto not needed at runtime; use plain object for tests

describe('AppService futuresBuyLot rebalancing logic', () => {
  let service: any;
  beforeEach(() => {
    jest.clearAllMocks();
    // Provide dummy services; futuresBuyLot does not use these
    service = new AppService({} as any, {} as any, {} as any, {} as any);
    // Stub normalizeTofStep to bypass binance.fstep and preserve qty
    service.normalizeTofStep = jest.fn().mockImplementation(async (qty: number) => qty);
  });

  it('should rebalance longs when conditions met', async () => {
    // Arrange: set up prices, positions, and balance to trigger rebalancing
    (binance.get_price as jest.Mock).mockResolvedValue(50);
    // One short with profit, one long with sufficient loss
    (binance.futuresPositionRisk as jest.Mock).mockResolvedValue([
      { symbol: 'FOO', positionAmt: '-2', entryPrice: '50', unRealizedProfit: '10' },
      { symbol: 'FOO', positionAmt: '5', entryPrice: '60', unRealizedProfit: '-20' },
    ]);
    (binance.futuresBalanceUSDT as jest.Mock).mockResolvedValue(1000);
    // Use a small futures step so normalization preserves fractional qty
    // binance.fstep not used since normalizeTofStep is stubbed
    (binance.futuresOrder as jest.Mock).mockResolvedValue({});

    const request: any = {
      ticker: 'FOO',
      direction: 'fBuy',
      price: 60,
      sl: 55,
      buyCoef: 1,
      sellCoef: 1,
    };

    // Act
    await service.futuresBuyLot(request);

    // Assert: first call closes the short position
    expect(binance.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO', side: 'BUY', type: 'MARKET', quantity: '2.00000000', positionSide: 'SHORT',
      }),
    );
    // Assert: second call rebalances the long position
    expect(binance.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO', side: 'SELL', type: 'MARKET', quantity: '0.50000000', positionSide: 'LONG',
      }),
    );
    // No additional calls (new entry purchase is skipped)
    expect((binance.futuresOrder as jest.Mock).mock.calls.length).toBe(2);
  });

  it('should not rebalance when longPnl above threshold', async () => {
    // Arrange: long loss not large enough to trigger rebalancing
    (binance.get_price as jest.Mock).mockResolvedValue(50);
    (binance.futuresPositionRisk as jest.Mock).mockResolvedValue([
      { symbol: 'FOO', positionAmt: '-2', entryPrice: '50', unRealizedProfit: '10' },
      { symbol: 'FOO', positionAmt: '5', entryPrice: '60', unRealizedProfit: '-5' },
    ]);
    (binance.futuresBalanceUSDT as jest.Mock).mockResolvedValue(1000);
    // binance.fstep not used since normalizeTofStep is stubbed
    (binance.futuresOrder as jest.Mock).mockResolvedValue({});

    const request: any = {
      ticker: 'FOO',
      direction: 'fBuy',
      price: 60,
      sl: 55,
      buyCoef: 1,
      sellCoef: 1,
    };

    // Act
    await service.futuresBuyLot(request);

    // Assert: only the short closure call, no rebalancing sell
    expect(binance.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({ side: 'BUY', positionSide: 'SHORT' }),
    );
    expect((binance.futuresOrder as jest.Mock).mock.calls.length).toBe(1);
    expect(binance.futuresOrder).not.toHaveBeenCalledWith(
      expect.objectContaining({ side: 'SELL', positionSide: 'LONG' }),
    );
  });
});
// Tests for futuresSellLot rebalancing logic
describe('AppService futuresSellLot rebalancing logic', () => {
  let service: any;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new AppService({} as any, {} as any, {} as any, {} as any);
    // Stub normalizeTofStep to bypass binance.fstep and preserve qty
    service.normalizeTofStep = jest.fn().mockImplementation(async (qty: number) => qty);
  });

  it('should rebalance shorts when conditions met', async () => {
    // Arrange: set up prices, positions, and balance to trigger rebalancing
    (binance.get_price as jest.Mock).mockResolvedValue(70);
    (binance.futuresPositionRisk as jest.Mock).mockResolvedValue([
      { symbol: 'FOO', positionAmt: '2', entryPrice: '50', unRealizedProfit: '2' },
      { symbol: 'FOO', positionAmt: '-4', entryPrice: '60', unRealizedProfit: '-20' },
    ]);
    (binance.futuresBalanceUSDT as jest.Mock).mockResolvedValue(1000);
    (binance.futuresOrder as jest.Mock).mockResolvedValue({});
    const request: any = {
      ticker: 'FOO',
      direction: 'fSell',
      price: 65,
      sl: 70,
      buyCoef: 1,
      sellCoef: 1,
    };

    // Act
    await service.futuresSellLot(request);

    // Assert: first call closes the long position
    expect(binance.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO', side: 'SELL', type: 'MARKET', quantity: '2.00000000', positionSide: 'LONG',
      }),
    );
    // Assert: second call rebalances the short position
    expect(binance.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO', side: 'BUY', type: 'MARKET', quantity: '0.10000000', positionSide: 'SHORT',
      }),
    );
    // No additional calls
    expect((binance.futuresOrder as jest.Mock).mock.calls.length).toBe(2);
  });

  it('should not rebalance when short losses are below threshold', async () => {
    // Arrange: long profit triggers close but short losses too small for rebalancing
    (binance.get_price as jest.Mock).mockResolvedValue(70);
    (binance.futuresPositionRisk as jest.Mock).mockResolvedValue([
      { symbol: 'FOO', positionAmt: '2', entryPrice: '50', unRealizedProfit: '2' },
      { symbol: 'FOO', positionAmt: '-4', entryPrice: '60', unRealizedProfit: '-5' },
    ]);
    (binance.futuresBalanceUSDT as jest.Mock).mockResolvedValue(1000);
    (binance.futuresOrder as jest.Mock).mockResolvedValue({});
    const request: any = {
      ticker: 'FOO',
      direction: 'fSell',
      price: 65,
      sl: 70,
      buyCoef: 1,
      sellCoef: 1,
    };

    // Act
    await service.futuresSellLot(request);

    // Assert: only the long closure call, no short rebalancing
    expect(binance.futuresOrder).toHaveBeenCalledWith(
      expect.objectContaining({ side: 'SELL', positionSide: 'LONG' }),
    );
    expect((binance.futuresOrder as jest.Mock).mock.calls.length).toBe(1);
    expect(binance.futuresOrder).not.toHaveBeenCalledWith(
      expect.objectContaining({ side: 'BUY', positionSide: 'SHORT' }),
    );
  });
});