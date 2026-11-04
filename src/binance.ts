import Binance, {
  CandleChartInterval,
  FuturesOrder,
  NewFuturesOrder,
  NewOrderSpot,
  Order,
  PositionRiskResult,
  SymbolFilterType,
} from 'binance-api-node';
import { Logger } from '@nestjs/common';

const QUOTE_CURRENCY = 'USDT';

const logger = new Logger('Binance');

// Unauthenticated client used only as a time source so signed requests stay
// aligned with the exchange clock.
const timeSource = Binance();

/** Shared authenticated client for every Binance consumer in the app. */
export const client = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  getTime: () => timeSource.time(),
});

export async function getPrice(ticker: string): Promise<number> {
  const prices = await client.prices();
  const currentPrice = parseFloat(prices[ticker]);
  if (!Number.isFinite(currentPrice)) {
    throw new Error(`No price available for ${ticker}`);
  }
  return currentPrice;
}

/** Sell at a fixed price with a LIMIT order (good-till-cancelled). */
export function limitSell(
  ticker: string,
  qty: number,
  limitPrice: number,
): Promise<Order> {
  const payload = {
    symbol: ticker,
    side: 'SELL',
    quantity: qty.toFixed(8),
    price: limitPrice.toFixed(8),
    type: 'LIMIT',
    timeInForce: 'GTC',
  };
  return client.order(payload as NewOrderSpot);
}

/** Buy immediately at market price with a MARKET order. */
export function marketBuy(ticker: string, qty: number): Promise<Order> {
  const payload = {
    symbol: ticker,
    side: 'BUY',
    quantity: qty.toFixed(8),
    type: 'MARKET',
  };
  return client.order(payload as NewOrderSpot);
}

/** Numeric value of the named key on the first filter matching one of the types. */
function filterNumber(
  filters: { filterType: string }[],
  types: string[],
  key: string,
  fallback = 0,
): number {
  const filter = filters.find((f) => types.includes(f.filterType)) as
    | Record<string, string>
    | undefined;
  const raw = filter?.[key];
  return raw ? Number.parseFloat(raw) : fallback;
}

export interface SpotSymbolFilters {
  minNotional: number;
  stepSize: number;
  tickSize: number;
}

/** Spot trading filters (min notional, lot step, price tick) for a symbol. */
export async function spotSymbolFilters(
  ticker: string,
): Promise<SpotSymbolFilters | undefined> {
  const info = await client.exchangeInfo({ symbol: ticker });
  const sym = info.symbols.find((x) => x.symbol === ticker);
  if (!sym) return undefined;
  const filters = sym.filters as { filterType: string }[];
  return {
    // Support both legacy MIN_NOTIONAL and newer NOTIONAL filter types
    minNotional: filterNumber(
      filters,
      [SymbolFilterType.MIN_NOTIONAL, 'NOTIONAL'],
      'minNotional',
    ),
    stepSize: filterNumber(filters, [SymbolFilterType.LOT_SIZE], 'stepSize'),
    tickSize: filterNumber(
      filters,
      [SymbolFilterType.PRICE_FILTER],
      'tickSize',
    ),
  };
}

/** Spot LOT_SIZE step for the symbol (minimum quantity increment). */
export async function lotStep(ticker: string): Promise<number> {
  const info = await client.exchangeInfo({ symbol: ticker });
  const sym = info.symbols.find((x) => x.symbol === ticker);
  return filterNumber(
    (sym?.filters ?? []) as { filterType: string }[],
    [SymbolFilterType.LOT_SIZE],
    'stepSize',
    0.0001,
  );
}

/** Futures LOT_SIZE step for the symbol (minimum quantity increment). */
export async function futuresLotStep(ticker: string): Promise<number> {
  const info = await client.futuresExchangeInfo();
  const sym = info.symbols.find((x) => x.symbol === ticker);
  return filterNumber(
    (sym?.filters ?? []) as { filterType: string }[],
    [SymbolFilterType.LOT_SIZE],
    'stepSize',
    0.0001,
  );
}

export async function baseCurrencyBalance(ticker: string): Promise<number> {
  const asset = ticker.substring(0, ticker.length - QUOTE_CURRENCY.length);
  const prices = await client.prices();
  const balances = (await client.accountInfo()).balances.filter(
    (x) => parseFloat(x.free) > 0 && x.asset === asset,
  );
  let result = 0;
  balances.forEach((x) => {
    if (parseFloat(prices[x.asset + QUOTE_CURRENCY])) {
      result += parseFloat(x.free);
    }
  });
  return result;
}

export async function totalBalanceUSDT(): Promise<number> {
  const account = await client.accountInfo();
  const balances = account.balances.filter((b) => parseFloat(b.free) > 0);
  const prices = await client.prices();
  let total = 0;
  for (const b of balances) {
    const free = parseFloat(b.free);
    if (b.asset === QUOTE_CURRENCY) {
      total += free;
    } else {
      const price = parseFloat(prices[b.asset + QUOTE_CURRENCY] ?? '0');
      if (price > 0) total += free * price;
    }
  }
  return total;
}

export async function freeBalanceUSDT(): Promise<number> {
  const account = await client.accountInfo();
  const usdt = account.balances.find((b) => b.asset === QUOTE_CURRENCY);
  return usdt ? parseFloat(usdt.free) : 0;
}

/** USDT wallet balance available in the futures account. */
export async function futuresBalanceUSDT(): Promise<number> {
  const balances = await client.futuresAccountBalance();
  const usdt = balances.find((b) => b.asset === QUOTE_CURRENCY);
  return usdt ? parseFloat(usdt.balance) : 0;
}

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function getCandles(
  symbol: string,
  interval: CandleChartInterval,
  limit: number,
): Promise<Candle[]> {
  const raw = await client.candles({ symbol, interval, limit });
  return raw.map((c) => ({
    openTime: c.openTime,
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume),
  }));
}

/** Place a USDT-M futures order. */
export function futuresOrder(options: NewFuturesOrder): Promise<FuturesOrder> {
  logger.log(
    `Futures order: ${options.side} ${'quantity' in options ? options.quantity : ''} ${options.symbol} (${options.positionSide ?? 'BOTH'})`,
  );
  return client.futuresOrder(options);
}

/** Current futures position risks, including entry price and position amount. */
export function futuresPositionRisk(): Promise<PositionRiskResult[]> {
  return client.futuresPositionRisk();
}
