import { PredictionService } from './prediction.service';
import { SignalLogEntry } from '../data-services/signal-logger.service';

function candle(close: number, i: number) {
  return {
    openTime: i,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  };
}

function signal(overrides: Partial<SignalLogEntry> = {}): SignalLogEntry {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    ticker: 'BTCUSDT',
    direction: 'aBuy',
    price: 100,
    buyCoef: 40,
    sellCoef: 0,
    atr: 0,
    stdev: 0,
    volRatio: 1,
    reliability: 0,
    ghostBuys: 0,
    ghostSells: 0,
    ghostPairsCount: 0,
    tradeCount: 0,
    initialFib: 0,
    a: 0,
    k: 0.4,
    fibN: 0,
    nextStepCoef: 1,
    ...overrides,
  };
}

describe('PredictionService.predict', () => {
  let service: PredictionService;
  let predictionLogger: { persistPrediction: jest.Mock };
  let createMock: jest.Mock;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    predictionLogger = {
      persistPrediction: jest.fn().mockResolvedValue(undefined),
    };
    service = new PredictionService(predictionLogger as never);
    createMock = jest.fn();
    (service as unknown as { client: unknown }).client = {
      chat: { completions: { create: createMock } },
    };
  });

  it('skips non-buy signals without calling the LLM', async () => {
    const result = await service.predict(signal({ direction: 'aSell' }));
    expect(result).toBeUndefined();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('enters at the LLM stop-loss and stops at the lowest zigzag low', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              ticker: 'BTCUSDT',
              time: '2026-01-01T00:00:00.000Z',
              entry: 99,
              stop_loss: 95,
              take_profit: 110,
            }),
          },
        },
      ],
    });
    // Lows at 80 (lowest) and 90 among the pivots
    const closes = [100, 95, 80, 95, 100, 95, 90, 95, 100];
    const entry = signal({ candles: closes.map(candle) });

    const record = await service.predict(entry);

    expect(record).toMatchObject({
      ticker: 'BTCUSDT',
      entry: 95, // the LLM stop-loss becomes the entry (strategy quirk)
      stop_loss: 80, // lowest zigzag low
      take_profit: 110,
      executed: false,
      // Must carry the signal's own timestamp or labeling can never match
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(predictionLogger.persistPrediction).toHaveBeenCalledWith(record);
  });

  it('rejects hallucinated responses before persisting anything', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: '{"ticker":"ETHUSDT"}' } }],
    });

    await expect(service.predict(signal())).rejects.toThrow(
      /expected "BTCUSDT"/,
    );
    expect(predictionLogger.persistPrediction).not.toHaveBeenCalled();
  });
});
