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
    // Log full incoming payload
    const timestamp = new Date().toLocaleTimeString();
    console.log(
      `Request @ ${timestamp} — payload: ${JSON.stringify(request)}`
    );
    // Calculate and log dynamic shrink coefficient k
    const k = this.appService.calcK(request);
    console.log(`Calculated shrink coefficient k: ${k.toFixed(4)}`);
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
