import { calcK, calcLocalGlobalPower, fibonacci } from './signal-math';
import { TWAlertDto } from './request';

function alert(overrides: Partial<TWAlertDto> = {}): TWAlertDto {
  return {
    ticker: 'BTCUSDT',
    direction: 'aBuy',
    price: 100,
    buyCoef: 0,
    sellCoef: 0,
    ...overrides,
  } as TWAlertDto;
}

describe('calcK', () => {
  it('clamps to maxK when every metric maximizes k', () => {
    // High volatility, no liquidity above average, zero reliability
    const k = calcK(alert({ atr: 1, stdev: 1, volRatio: 1, reliability: 0 }));
    expect(k).toBe(1.0);
  });

  it('clamps to minK when every metric minimizes k', () => {
    const k = calcK(alert({ atr: 0, stdev: 0, volRatio: 2, reliability: 1 }));
    expect(k).toBe(0.05);
  });

  it('weights metrics for intermediate values', () => {
    // atrN=0.5, stdevN=0.5, volInv=1, relInv=0.5
    const k = calcK(
      alert({ atr: 0.01, stdev: 0.015, volRatio: 1, reliability: 0.5 }),
    );
    expect(k).toBeCloseTo(0.3 * 0.5 + 0.3 * 0.5 + 0.2 * 1 + 0.2 * 0.5, 10);
  });

  it('defaults missing metrics to the neutral values', () => {
    // atr=0, stdev=0, volRatio=1 (volInv=1), reliability=0 (relInv=1)
    expect(calcK(alert())).toBeCloseTo(0.4, 10);
  });
});

describe('fibonacci', () => {
  it('matches the 1,2,3,5,8 sequence used for lot thresholds', () => {
    expect([0, 1, 2, 3, 4, 5].map(fibonacci)).toEqual([0, 1, 2, 3, 5, 8]);
  });
});

describe('calcLocalGlobalPower', () => {
  it('returns zero power with no band data', () => {
    expect(calcLocalGlobalPower(alert())).toEqual([0, 0]);
  });

  it('returns full positive local power when price tops all local up-bands', () => {
    const [local, global] = calcLocalGlobalPower(
      alert({
        price: 100,
        tfDir: 'isUp',
        tfUpperVal: 100,
        tfLowerVal: 0,
        tf1Dir: 'isUp',
        tf1UpperVal: 100,
        tf1LowerVal: 0,
        tf2Dir: 'isUp',
        tf2UpperVal: 100,
        tf2LowerVal: 0,
      }),
    );
    expect(local).toBe(1);
    expect(global).toBe(0);
  });

  it('scales inner-band direction by proximity', () => {
    // Price halfway in an isInnerDown band on the first global timeframe
    const [local, global] = calcLocalGlobalPower(
      alert({
        price: 50,
        tf3Dir: 'isInnerDown',
        tf3UpperVal: 100,
        tf3LowerVal: 0,
      }),
    );
    expect(local).toBe(0);
    // weight 3 of [3,5,8] => -0.5 * 3/16
    expect(global).toBeCloseTo((-0.5 * 3) / 16, 10);
  });

  it('treats legacy isInner as a -1..1 scale', () => {
    const [local] = calcLocalGlobalPower(
      alert({ price: 25, tfDir: 'isInner', tfUpperVal: 100, tfLowerVal: 0 }),
    );
    // pNorm=0.25 -> scaled -0.5, weight 1 of [1,2,3] => -0.5/6
    expect(local).toBeCloseTo(-0.5 / 6, 10);
  });

  it('ignores bands with an empty or unknown direction', () => {
    const [local, global] = calcLocalGlobalPower(
      alert({ price: 50, tfDir: 'sideways', tfUpperVal: 100, tfLowerVal: 0 }),
    );
    expect(local).toBe(0);
    expect(global).toBe(0);
  });
});
