import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TradeLoggerService } from './trade-logger.service';
import { GhostTradeService } from './ghost-trade.service';
@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, TradeLoggerService, GhostTradeService],
})
export class AppModule {}
