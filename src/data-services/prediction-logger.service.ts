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
import {
  ensureJsonFile,
  readJsonArraySync,
  writeJsonArraySync,
} from '../json-store';

const PREDICTIONS_PATH = path.resolve(__dirname, '../../data/predictions.json');
const ORDERS_LOG_PATH = path.resolve(
  __dirname,
  '../../data/prediction-orders.json',
);

@Injectable()
export class PredictionLoggerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PredictionLoggerService.name);
  private watcher?: fs.FSWatcher;

  constructor(private eventEmitter: EventEmitter2) {}

  onModuleInit() {
    ensureJsonFile(ORDERS_LOG_PATH);
    // Ensure predictions file exists before watching
    ensureJsonFile(PREDICTIONS_PATH);

    try {
      this.watcher = fs.watch(PREDICTIONS_PATH, (eventType) => {
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
  persistPrediction(record: PredictionRecord) {
    const existing = this.getPredictions();
    const updated = existing.filter(
      (r) => !(r.ticker === record.ticker && r.executed === false),
    );
    updated.push(record);
    writeJsonArraySync(PREDICTIONS_PATH, updated);
  }

  persistPredictions(predictions: PredictionRecord[]) {
    writeJsonArraySync(PREDICTIONS_PATH, predictions);
  }

  getPredictions(): PredictionRecord[] {
    return readJsonArraySync<PredictionRecord>(PREDICTIONS_PATH);
  }

  persistOrderLog(log: OrderLog) {
    const orders = readJsonArraySync<OrderLog>(ORDERS_LOG_PATH);
    orders.push(log);
    writeJsonArraySync(ORDERS_LOG_PATH, orders);
  }
}
