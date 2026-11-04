import {
  Body,
  Controller,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { SpotTradeService } from './spot-trade.service';
import { FuturesTradeService } from './futures-trade.service';
import { TWAlertDto } from './request';

@Controller('api')
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly spotTrades: SpotTradeService,
    private readonly futuresTrades: FuturesTradeService,
  ) {}

  @Post('alert')
  async processAlert(@Body() request: TWAlertDto) {
    // Opt-in shared-secret check: enforced only when ALERT_TOKEN is configured
    const expectedToken = process.env.ALERT_TOKEN;
    if (expectedToken && request.token !== expectedToken) {
      this.logger.warn('Alert rejected: missing or invalid token');
      throw new UnauthorizedException();
    }
    // Keep the shared secret out of the logs
    const payload = { ...request, token: undefined };
    this.logger.log(`Alert received: ${JSON.stringify(payload)}`);
    try {
      switch (request.direction) {
        case 'aBuy':
          return { status: 'ok', data: await this.spotTrades.buyLot(request) };
        case 'aSell':
          return { status: 'ok', data: await this.spotTrades.sellLot(request) };
        case 'fBuy':
          return {
            status: 'ok',
            data: await this.futuresTrades.openLong(request),
          };
        case 'fSell':
          return {
            status: 'ok',
            data: await this.futuresTrades.openShort(request),
          };
      }
    } catch (e: unknown) {
      this.logger.error(
        'Alert processing failed',
        e instanceof Error ? e.stack : String(e),
      );
      return {
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
