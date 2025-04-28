import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TradeLoggerService } from './trade-logger.service';
import { GhostTradeService } from './ghost-trade.service';
import { SignalLoggerService } from './signal-logger.service';
import { PredictionService } from './prediction.service';
import { PredictionExecutorService } from './prediction-executor.service';
@Module({
  imports: [],
  controllers: [AppController],
  providers: [
    AppService,
    TradeLoggerService,
    GhostTradeService,
    SignalLoggerService,
    PredictionService,
    // Executor for live order execution based on predictions
    PredictionExecutorService,
  ],
})
export class AppModule {}
