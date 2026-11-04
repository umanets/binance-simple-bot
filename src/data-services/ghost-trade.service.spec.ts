import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GhostTradeService } from './ghost-trade.service';

describe('GhostTradeService', () => {
  let dir: string;
  let service: GhostTradeService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-'));
    service = new GhostTradeService();
    // Redirect the store to a temp dir so tests never touch real data files
    (service as unknown as { buyPath: string }).buyPath = path.join(
      dir,
      'buys.json',
    );
    (service as unknown as { sellPath: string }).sellPath = path.join(
      dir,
      'sells.json',
    );
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty and records ghost trades per side', async () => {
    await expect(service.getGhostBuyTrades()).resolves.toEqual([]);
    await service.addGhostBuyTrade({ ticker: 'FOO', price: 1 });
    await service.addGhostSellTrade({ ticker: 'FOO', price: 2 });
    await expect(service.getGhostBuyTrades()).resolves.toEqual([
      { ticker: 'FOO', price: 1 },
    ]);
    await expect(service.getGhostSellTrades()).resolves.toEqual([
      { ticker: 'FOO', price: 2 },
    ]);
  });

  it('removes both sides for a ticker and keeps other tickers', async () => {
    await service.addGhostBuyTrade({ ticker: 'FOO', price: 1 });
    await service.addGhostBuyTrade({ ticker: 'BAR', price: 3 });
    await service.addGhostSellTrade({ ticker: 'FOO', price: 2 });

    await service.removeTradesByTicker('FOO');

    await expect(service.getGhostBuyTrades()).resolves.toEqual([
      { ticker: 'BAR', price: 3 },
    ]);
    await expect(service.getGhostSellTrades()).resolves.toEqual([]);
  });
});
