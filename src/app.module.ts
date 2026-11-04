import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { SpotTradeService } from './spot-trade.service';
import { FuturesTradeService } from './futures-trade.service';
import { TradeLoggerService } from './data-services/trade-logger.service';
import { GhostTradeService } from './data-services/ghost-trade.service';
import { SignalLoggerService } from './data-services/signal-logger.service';
import { PredictionService } from './prediction.service';
import { PredictionExecutorService } from './prediction-executor.service';
import { PredictionLoggerService } from './data-services/prediction-logger.service';

@Module({
  imports: [EventEmitterModule.forRoot()],
  controllers: [AppController],
  providers: [
    SpotTradeService,
    FuturesTradeService,
    TradeLoggerService,
    GhostTradeService,
    SignalLoggerService,
    PredictionService,
    PredictionLoggerService,
    // Live prediction trading stays off unless ENABLE_PREDICTION_EXECUTOR=true
    PredictionExecutorService,
  ],
})
export class AppModule {}
