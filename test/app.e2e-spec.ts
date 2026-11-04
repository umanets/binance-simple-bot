import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { SpotTradeService } from '../src/spot-trade.service';
import { FuturesTradeService } from '../src/futures-trade.service';

describe('POST /api/alert (webhook pipeline)', () => {
  let app: INestApplication;
  const server = (): App => app.getHttpServer() as App;
  const spotTrades = {
    buyLot: jest.fn(),
    sellLot: jest.fn(),
  };
  const futuresTrades = {
    openLong: jest.fn(),
    openShort: jest.fn(),
  };

  const validAlert = {
    ticker: 'BTCUSDT',
    direction: 'aBuy',
    price: 60000,
    buyCoef: 40,
    sellCoef: 0,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: SpotTradeService, useValue: spotTrades },
        { provide: FuturesTradeService, useValue: futuresTrades },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror the global pipe configured in main.ts
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ALERT_TOKEN;
  });

  it('routes aBuy alerts to the spot service and returns the ok envelope', async () => {
    spotTrades.buyLot.mockResolvedValue({ orderId: 1 });

    const res = await request(server())
      .post('/api/alert')
      .send(validAlert)
      .expect(201);

    expect(res.body).toEqual({ status: 'ok', data: { orderId: 1 } });
    expect(spotTrades.buyLot).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: 'BTCUSDT', direction: 'aBuy' }),
    );
  });

  it('routes fSell alerts to the futures service', async () => {
    futuresTrades.openShort.mockResolvedValue(undefined);

    const res = await request(server())
      .post('/api/alert')
      .send({ ...validAlert, direction: 'fSell' })
      .expect(201);

    expect(res.body).toEqual({ status: 'ok' });
    expect(futuresTrades.openShort).toHaveBeenCalled();
  });

  it('returns the error envelope when the trade service throws', async () => {
    spotTrades.buyLot.mockRejectedValue(new Error('exchange down'));

    const res = await request(server())
      .post('/api/alert')
      .send(validAlert)
      .expect(201);

    expect(res.body).toEqual({ status: 'error', error: 'exchange down' });
  });

  it('rejects unsupported directions with a validation error', async () => {
    await request(server())
      .post('/api/alert')
      .send({ ...validAlert, direction: 'dBuy' })
      .expect(400);

    expect(spotTrades.buyLot).not.toHaveBeenCalled();
    expect(futuresTrades.openLong).not.toHaveBeenCalled();
  });

  it('rejects payloads without the required price', async () => {
    const withoutPrice: Partial<typeof validAlert> = { ...validAlert };
    delete withoutPrice.price;
    await request(server()).post('/api/alert').send(withoutPrice).expect(400);
  });

  it('enforces the shared secret when ALERT_TOKEN is configured', async () => {
    process.env.ALERT_TOKEN = 's3cret';

    await request(server()).post('/api/alert').send(validAlert).expect(401);

    spotTrades.buyLot.mockResolvedValue(undefined);
    const res = await request(server())
      .post('/api/alert')
      .send({ ...validAlert, token: 's3cret' })
      .expect(201);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
