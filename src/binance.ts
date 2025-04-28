import Binance, { NewOrderSpot, SymbolFilterType, CandleChartInterval } from 'binance-api-node';

import * as dotenv from 'dotenv';
dotenv.config();

const QUOTE_CURRENCY = 'USDT';

const c = Binance();
const client = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  getTime: () => c.time(),
});

async function get_price(ticker: string) {
  const prices = await client.prices();
  const currentPrice = parseFloat(prices[ticker]);
  return currentPrice;
}

async function sell(ticker: string, qty: number, limit_price: number) {
  const payload = {
    symbol: ticker,
    side: 'SELL',
    quantity: qty.toFixed(8),
    price: limit_price.toFixed(8),
    type: 'LIMIT',
    timeInForce: 'GTC',
  };
  return await client.order(payload as NewOrderSpot);
}

async function buy(ticker: string, qty: number) {
  const payload = {
    symbol: ticker,
    side: 'BUY',
    quantity: qty.toFixed(8),
    type: 'MARKET',
  };
  return await client.order(payload as NewOrderSpot);
}

async function step(ticker: string) {
  const tickerInfo = await client.exchangeInfo({ symbol: ticker });
  const symbolInfo = tickerInfo.symbols.find((x) => x.symbol === ticker);
  const lotSizeFilter = symbolInfo?.filters.find(
    (f) => f.filterType === SymbolFilterType.LOT_SIZE,
  ) as { stepSize?: string } | undefined;
  const stepSize: string | undefined = lotSizeFilter?.stepSize ?? '0.0001';
  return Number.parseFloat(stepSize);
}

async function base_currency_balance(ticker: string) {
  const asset = ticker.substring(0, ticker.length - QUOTE_CURRENCY.length);
  const prices = await client.prices();
  const balances = (await client.accountInfo()).balances.filter(
    (x) => parseFloat(x.free) > 0 && x.asset === asset,
  );
  let result = 0;
  balances.forEach((x) => {
    if (parseFloat(prices[x.asset + 'USDT'])) result += parseFloat(x.free);
  });
  return result;
}

async function totalBalanceUSDT(): Promise<number> {
  const account = await client.accountInfo();
  const balances = account.balances.filter((b) => parseFloat(b.free) > 0);
  const prices = await client.prices();
  let total = 0;
  for (const b of balances) {
    const asset = b.asset;
    const free = parseFloat(b.free);
    if (asset === QUOTE_CURRENCY) {
      total += free;
    } else {
      const pair = asset + QUOTE_CURRENCY;
      const price = parseFloat(prices[pair] ?? '0');
      if (price > 0) total += free * price;
    }
  }
  return total;
}

async function freeBalanceUSDT(): Promise<number> {
  const account = await client.accountInfo();
  const usdt = account.balances.find((b) => b.asset === QUOTE_CURRENCY);
  return usdt ? parseFloat(usdt.free) : 0;
}

// Fetch recent candlestick data
async function getCandles(
  symbol: string,
  interval: CandleChartInterval,
  limit: number,
): Promise<{ openTime: number; open: number; high: number; low: number; close: number; volume: number }[]> {
  const raw = await client.candles({ symbol, interval, limit });
  return raw.map(c => ({
    openTime: c.openTime,
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume),
  }));
}

export {
  get_price,
  buy,
  sell,
  step,
  base_currency_balance,
  totalBalanceUSDT,
  freeBalanceUSDT,
  getCandles,
};
