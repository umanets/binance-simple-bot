import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderLog, PredictionRecord } from '../models';
import { ensureJsonFile, readJsonArray, writeJsonArray } from '../json-store';

const PREDICTIONS_PATH = path.resolve(__dirname, '../../data/predictions.json');
const ORDERS_LOG_PATH = path.resolve(
  __dirname,
  '../../data/prediction-orders.json',
);

@Injectable()
export class PredictionLoggerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PredictionLoggerService.name);
  private predictionsPath = PREDICTIONS_PATH;
  private ordersLogPath = ORDERS_LOG_PATH;
  private watcher?: fs.FSWatcher;

  constructor(private eventEmitter: EventEmitter2) {}

  onModuleInit() {
    ensureJsonFile(this.ordersLogPath);
    // Ensure predictions file exists before watching
    ensureJsonFile(this.predictionsPath);

    try {
      this.watcher = fs.watch(this.predictionsPath, (eventType) => {
        if (eventType === 'change') {
          this.eventEmitter.emit('predictions.changed');
        }
      });
    } catch (err) {
      this.logger.error(
        'Failed to watch predictions.json',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  onModuleDestroy() {
    this.watcher?.close();
  }

  /** Store a prediction, replacing any unexecuted entry for the same ticker. */
  async persistPrediction(record: PredictionRecord): Promise<void> {
    const existing = await this.getPredictions();
    const updated = existing.filter(
      (r) => !(r.ticker === record.ticker && r.executed === false),
    );
    updated.push(record);
    await writeJsonArray(this.predictionsPath, updated);
  }

  async persistPredictions(predictions: PredictionRecord[]): Promise<void> {
    await writeJsonArray(this.predictionsPath, predictions);
  }

  async getPredictions(): Promise<PredictionRecord[]> {
    return readJsonArray<PredictionRecord>(this.predictionsPath);
  }

  async persistOrderLog(log: OrderLog): Promise<void> {
    const orders = await readJsonArray<OrderLog>(this.ordersLogPath);
    orders.push(log);
    await writeJsonArray(this.ordersLogPath, orders);
  }
}
