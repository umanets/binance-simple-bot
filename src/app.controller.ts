import {
  Body,
  Controller,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AppService } from './app.service';
import { TWAlertDto } from './request';

@Controller('api')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('alert')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async processAlert(@Body() request: TWAlertDto) {
    console.log(
      `request: ${new Date().toLocaleTimeString()} === ${request.ticker}: ${request.direction}, price: ${request.price}, buyCoef: ${request.buyCoef}, sellCoef: ${request.sellCoef}`
    );
    try {
      if (request.direction === 'aSell') {
        const result = await this.appService.sellLot(request);
        return { status: 'ok', data: result };
      }

      if (request.direction === 'aBuy') {
        const result = await this.appService.buyLot(request);
        return { status: 'ok', data: result };
      }
    } catch (e: unknown) {
      if (e instanceof Error) {
        return { status: 'error', error: e.message };
      }
      return { status: 'error', error: String(e) };
    }
  }
}
