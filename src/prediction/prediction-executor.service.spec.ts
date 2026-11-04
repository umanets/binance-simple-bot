jest.mock('../binance', () => ({
  client: { order: jest.fn(), ws: { trades: jest.fn() } },
  spotSymbolFilters: jest.fn(),
}));

import { client } from '../binance';
import {
  BINANCE_INSUFFICIENT_BALANCE,
  PredictionExecutorService,
} from './prediction-executor.service';
import { PredictionRecord } from '../models';

const orderMock = (client as unknown as { order: jest.Mock }).order;

type ExecutorInternals = {
  predictions: PredictionRecord[];
  symbolFilters: Record<
    string,
    { minNotional: number; stepSize: number; tickSize: number }
  >;
  handlePrice(ticker: string, price: number): Promise<void>;
};

describe('PredictionExecutorService price handling', () => {
  let service: PredictionExecutorService;
  let internals: ExecutorInternals;
  let signalLogger: { labelSignal: jest.Mock };
  let predictionLogger: {
    persistPredictions: jest.Mock;
    persistOrderLog: jest.Mock;
    getPredictions: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    signalLogger = { labelSignal: jest.fn().mockResolvedValue(undefined) };
    predictionLogger = {
      persistPredictions: jest.fn().mockResolvedValue(undefined),
      persistOrderLog: jest.fn().mockResolvedValue(undefined),
      getPredictions: jest.fn().mockResolvedValue([]),
    };
    service = new PredictionExecutorService(
      signalLogger as never,
      predictionLogger as never,
    );
    internals = service as unknown as ExecutorInternals;
    internals.symbolFilters.FOO = {
      minNotional: 10,
      stepSize: 0.001,
      tickSize: 0.01,
    };
  });

  function prediction(overrides: Partial<PredictionRecord>): PredictionRecord {
    return {
      ticker: 'FOO',
      entry: 100,
      stop_loss: 90,
      take_profit: 120,
      executed: false,
      timestamp: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('buys twice the minimum notional when price reaches the entry level', async () => {
    internals.predictions = [prediction({})];
    orderMock.mockResolvedValue({
      executedQty: '0.202',
      cummulativeQuoteQty: '20',
    });

    await internals.handlePrice('FOO', 99);

    expect(orderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO',
        side: 'BUY',
        type: 'MARKET',
        quantity: '0.202',
      }),
    );
    const rec = internals.predictions[0];
    expect(rec.executed).toBe(true);
    expect(rec.executedQty).toBe(0.202);
    expect(rec.entryExecutedPrice).toBeCloseTo(20 / 0.202, 10);
    expect(predictionLogger.persistPredictions).toHaveBeenCalled();
  });

  it('places a tick-quantized limit sell and labels the signal at take-profit', async () => {
    internals.predictions = [
      prediction({
        executed: true,
        executedQty: 0.202,
        entryExecutedPrice: 99,
      }),
    ];
    orderMock.mockResolvedValue({});

    await internals.handlePrice('FOO', 121);

    expect(orderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO',
        side: 'SELL',
        type: 'LIMIT',
        quantity: '0.202',
        price: '120',
      }),
    );
    expect(predictionLogger.persistOrderLog).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'FOO',
        buyPrice: 99,
        sellPrice: 120,
        profit: expect.closeTo((120 - 99) * 0.202, 10) as number,
      }),
    );
    expect(signalLogger.labelSignal).toHaveBeenCalledWith(
      'FOO',
      '2026-01-01T00:00:00.000Z',
      expect.closeTo((120 - 99) * 0.202, 10) as number,
    );
    expect(internals.predictions).toHaveLength(0);
  });

  it('drops the prediction instead of retrying when the sell has no balance', async () => {
    internals.predictions = [
      prediction({
        executed: true,
        executedQty: 0.202,
        entryExecutedPrice: 99,
      }),
    ];
    orderMock.mockRejectedValue(
      Object.assign(new Error('no balance'), {
        code: BINANCE_INSUFFICIENT_BALANCE,
      }),
    );

    await internals.handlePrice('FOO', 121);

    expect(internals.predictions).toHaveLength(0);
    expect(predictionLogger.persistPredictions).toHaveBeenCalled();
    expect(predictionLogger.persistOrderLog).not.toHaveBeenCalled();
  });
});
