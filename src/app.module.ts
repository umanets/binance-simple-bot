import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TradeLoggerService } from './trade-logger.service';
@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, TradeLoggerService],
})
export class AppModule {}
