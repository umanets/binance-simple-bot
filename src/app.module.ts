import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TradeLoggerService } from './data-services/trade-logger.service';
import { GhostTradeService } from './data-services/ghost-trade.service';
import { SignalLoggerService } from './data-services/signal-logger.service';
import { PredictionService } from './prediction.service';
import { PredictionExecutorService } from './prediction-executor.service';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PredictionLoggerService } from './data-services/prediction-logger.service';
@Module({
  imports: [EventEmitterModule.forRoot()],
  controllers: [AppController],
  providers: [
    AppService,
    TradeLoggerService,
    GhostTradeService,
    SignalLoggerService,
    PredictionService,
    PredictionLoggerService,
    PredictionExecutorService,
  ],
})
export class AppModule {}
