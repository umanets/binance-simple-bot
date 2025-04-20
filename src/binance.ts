import Binance, { NewOrderSpot, SymbolFilterType } from 'binance-api-node';

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

export { get_price, buy, sell, step, base_currency_balance };
