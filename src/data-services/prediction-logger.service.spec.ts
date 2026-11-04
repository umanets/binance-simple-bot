import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PredictionLoggerService } from './prediction-logger.service';
import { PredictionRecord } from '../models';

describe('PredictionLoggerService', () => {
  let dir: string;
  let service: PredictionLoggerService;

  function record(overrides: Partial<PredictionRecord>): PredictionRecord {
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

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pred-'));
    service = new PredictionLoggerService({ emit: jest.fn() } as never);
    // Redirect the store to a temp dir so tests never touch real data files
    const internals = service as unknown as {
      predictionsPath: string;
      ordersLogPath: string;
    };
    internals.predictionsPath = path.join(dir, 'predictions.json');
    internals.ordersLogPath = path.join(dir, 'orders.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('persistPrediction replaces the unexecuted entry for the same ticker', async () => {
    await service.persistPrediction(record({ entry: 100 }));
    await service.persistPrediction(record({ entry: 95 }));

    const stored = await service.getPredictions();
    expect(stored).toHaveLength(1);
    expect(stored[0].entry).toBe(95);
  });

  it('persistPrediction keeps executed entries and other tickers', async () => {
    await service.persistPrediction(record({ executed: true, entry: 100 }));
    await service.persistPrediction(record({ ticker: 'BAR' }));
    await service.persistPrediction(record({ entry: 95 }));

    const stored = await service.getPredictions();
    expect(stored).toHaveLength(3);
  });

  it('appends order logs', async () => {
    await service.persistOrderLog({
      ticker: 'FOO',
      signalTime: '2026-01-01T00:00:00.000Z',
      buyPrice: 99,
      qty: 1,
      sellTime: '2026-01-02T00:00:00.000Z',
      sellPrice: 120,
      profit: 21,
    });
    const raw = fs.readFileSync(path.join(dir, 'orders.json'), 'utf-8');
    expect(JSON.parse(raw)).toHaveLength(1);
  });
});
