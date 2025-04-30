import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter2 } from '@nestjs/event-emitter';

const PREDICTIONS_PATH = path.resolve(__dirname, '../../data/predictions.json');
const ORDERS_LOG_PATH = path.resolve(__dirname, '../../data/prediction-orders.json');

@Injectable()
export class PredictionLoggerService implements OnModuleInit, OnModuleDestroy {
    private watcher?: fs.FSWatcher;
    constructor(private eventEmitter: EventEmitter2) { }
    
    onModuleInit() {
        // Ensure orders log exists
        if (!fs.existsSync(ORDERS_LOG_PATH)) {
            fs.writeFileSync(ORDERS_LOG_PATH, '[]');
        }
        // Ensure predictions file exists before watching
        if (!fs.existsSync(PREDICTIONS_PATH)) {
            fs.writeFileSync(PREDICTIONS_PATH, '[]');
        }

        try {
            this.watcher = fs.watch(PREDICTIONS_PATH, (eventType) => {
                if (eventType === 'change') {
                    this.eventEmitter.emit('predictions.changed');
                }
            });
        } catch (err) {
            console.error('Failed to watch predictions.json:', err);
        }
    }

    onModuleDestroy() {
        if (this.watcher) {
            this.watcher.close();
        }
    }

    persistPrediction(record: PredictionRecord) {
        const arr = JSON.parse(fs.readFileSync(PREDICTIONS_PATH, 'utf-8')) as any[];
        const updated = arr.filter(
            (r: any) => !(r.ticker === record.ticker && r.executed === false)
        );
        updated.push(record);
        fs.writeFileSync(PREDICTIONS_PATH, JSON.stringify(updated, null, 2));
    }

    persistPredictions(predictions: PredictionRecord[]) {
        fs.writeFileSync(
              PREDICTIONS_PATH,
              JSON.stringify(predictions, null, 2)
        );
    }

    getPredictions(): PredictionRecord[] {
        let newPreds: PredictionRecord[] = [];
        try {
            const data = fs.readFileSync(PREDICTIONS_PATH, 'utf-8');
            newPreds = JSON.parse(data) as PredictionRecord[];
        } catch {
            newPreds = [];
        }
        return newPreds;
    }

    persistOrderLog(log: OrderLog) {
        const arr: OrderLog[] = JSON.parse(
          fs.readFileSync(ORDERS_LOG_PATH, 'utf-8')
        );
        arr.push(log);
        fs.writeFileSync(ORDERS_LOG_PATH, JSON.stringify(arr, null, 2));
    }
}