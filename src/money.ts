import Decimal from 'decimal.js';

/** Shorthand constructor for exact decimal arithmetic on money values. */
export const D = (value: number | string): Decimal => new Decimal(value);

/**
 * Floor a quantity/price down to an exact multiple of an exchange step
 * (LOT_SIZE stepSize or PRICE_FILTER tickSize). Returns the value unchanged
 * when the step is zero or missing.
 */
export function floorToStep(value: Decimal, step: number): Decimal {
  if (!step || step <= 0) return value;
  const s = D(step);
  return value.div(s).floor().mul(s);
}
