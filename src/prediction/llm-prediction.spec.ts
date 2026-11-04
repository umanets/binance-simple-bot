import { extractZigZag, parseLlmPrediction } from './llm-prediction';
import { SignalLogEntry } from '../data-services/signal-logger.service';

const signal = { ticker: 'BTCUSDT', price: 100 } as SignalLogEntry;

function response(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ticker: 'BTCUSDT',
    time: '2026-01-01T00:00:00.000Z',
    entry: 99,
    stop_loss: 95,
    take_profit: 110,
    ...overrides,
  });
}

describe('parseLlmPrediction', () => {
  it('accepts a valid prediction', () => {
    const result = parseLlmPrediction(response(), signal);
    expect(result).toEqual({
      ticker: 'BTCUSDT',
      time: '2026-01-01T00:00:00.000Z',
      entry: 99,
      stop_loss: 95,
      take_profit: 110,
    });
  });

  it('strips markdown code fences before parsing', () => {
    const fenced = '```json\n' + response() + '\n```';
    expect(parseLlmPrediction(fenced, signal).entry).toBe(99);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseLlmPrediction('not json', signal)).toThrow(
      /not valid JSON/,
    );
  });

  it('rejects a ticker mismatch', () => {
    expect(() =>
      parseLlmPrediction(response({ ticker: 'ETHUSDT' }), signal),
    ).toThrow(/expected "BTCUSDT"/);
  });

  it('rejects non-finite and non-positive levels', () => {
    expect(() => parseLlmPrediction(response({ entry: 0 }), signal)).toThrow(
      /positive finite/,
    );
    expect(() =>
      parseLlmPrediction(response({ stop_loss: 'cheap' }), signal),
    ).toThrow(/positive finite/);
  });

  it('rejects levels implausibly far from the signal price', () => {
    expect(() =>
      parseLlmPrediction(response({ take_profit: 10000 }), signal),
    ).toThrow(/deviates more than 5x/);
    expect(() => parseLlmPrediction(response({ entry: 10 }), signal)).toThrow(
      /deviates more than 5x/,
    );
  });

  it('rejects an inverted stop/target pair', () => {
    expect(() =>
      parseLlmPrediction(
        response({ stop_loss: 120, take_profit: 110 }),
        signal,
      ),
    ).toThrow(/must be below take_profit/);
  });
});

describe('extractZigZag', () => {
  function candles(closes: number[]) {
    return closes.map((close, i) => ({
      openTime: i,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
    }));
  }

  it('returns no pivots when there are too few candles', () => {
    expect(extractZigZag(candles([1, 2, 3]))).toEqual([]);
  });

  it('finds local highs and lows', () => {
    const points = extractZigZag(candles([1, 2, 5, 2, 1, 2, 0.5, 2, 1]));
    expect(points).toContainEqual({ time: 2, price: 5, type: 'high' });
    expect(points).toContainEqual({ time: 6, price: 0.5, type: 'low' });
  });
});
