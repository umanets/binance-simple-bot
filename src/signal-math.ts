import { TWAlertDto } from './request';

// Parameters for dynamic k calculation (weights, thresholds, min/max)
const DYNAMIC_K_PARAMS = {
  atrThreshold: 0.02,
  stdevThreshold: 0.03,
  volRatioThreshold: 1.0,
  wAtr: 0.3,
  wStdev: 0.3,
  wVol: 0.2,
  wRel: 0.2,
  minK: 0.05,
  maxK: 1.0,
};

/** Calculate the dynamic shrink coefficient k from alert metrics. */
export function calcK(request: TWAlertDto): number {
  const atr = request.atr ?? 0;
  const stdev = request.stdev ?? 0;
  const volRatio = request.volRatio ?? 1;
  const reliability = request.reliability ?? 0;
  const p = DYNAMIC_K_PARAMS;
  const atrN = Math.min(atr / p.atrThreshold, 1);
  const stdevN = Math.min(stdev / p.stdevThreshold, 1);
  // Inverse of volRatio beyond 1 -> higher liquidity lowers k
  const volInv = 1 - Math.min((volRatio - 1) / p.volRatioThreshold, 1);
  // Inverse of reliability -> higher reliability lowers k
  const relInv = 1 - reliability;
  const rawK =
    p.wAtr * atrN + p.wStdev * stdevN + p.wVol * volInv + p.wRel * relInv;
  return Math.max(p.minK, Math.min(rawK, p.maxK));
}

/** Fibonacci sequence matching 1,2,3,5,... for n >= 1. */
export function fibonacci(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  let a = 1;
  let b = 2;
  for (let i = 3; i <= n; i++) {
    const c = a + b;
    a = b;
    b = c;
  }
  return b;
}

interface TimeframeBand {
  dir: string;
  upper: number;
  lower: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

/**
 * Signed score in [-1..1] for the price's position inside one EMA band.
 * Inner-band directions scale by proximity: isInnerUp (0..1),
 * isInnerDown (0..-1), legacy isInner (-1..+1). Plain up/down directions
 * contribute their sign scaled by proximity inside the band.
 */
function bandScore(band: TimeframeBand, price: number): number {
  const span = band.upper - band.lower;
  if (band.dir.startsWith('isInner')) {
    if (span <= 0) return 0;
    const pNorm = clamp01((price - band.lower) / span);
    if (band.dir === 'isInnerUp') return pNorm;
    if (band.dir === 'isInnerDown') return -pNorm;
    return pNorm * 2 - 1;
  }
  const s = band.dir.toLowerCase();
  let dir = 0;
  if (s.includes('up')) dir = 1;
  else if (s.includes('down')) dir = -1;
  if (dir === 0 || span <= 0) return 0;
  return dir * clamp01((price - band.lower) / span);
}

function timeframeBands(request: TWAlertDto): TimeframeBand[] {
  return [
    {
      dir: request.tfDir ?? '',
      upper: request.tfUpperVal ?? 0,
      lower: request.tfLowerVal ?? 0,
    },
    {
      dir: request.tf1Dir ?? '',
      upper: request.tf1UpperVal ?? 0,
      lower: request.tf1LowerVal ?? 0,
    },
    {
      dir: request.tf2Dir ?? '',
      upper: request.tf2UpperVal ?? 0,
      lower: request.tf2LowerVal ?? 0,
    },
    {
      dir: request.tf3Dir ?? '',
      upper: request.tf3UpperVal ?? 0,
      lower: request.tf3LowerVal ?? 0,
    },
    {
      dir: request.tf4Dir ?? '',
      upper: request.tf4UpperVal ?? 0,
      lower: request.tf4LowerVal ?? 0,
    },
    {
      dir: request.tf5Dir ?? '',
      upper: request.tf5UpperVal ?? 0,
      lower: request.tf5LowerVal ?? 0,
    },
  ];
}

function weightedBandPower(
  bands: TimeframeBand[],
  weights: number[],
  price: number,
): number {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i] * bandScore(bands[i], price);
  }
  return Math.max(-1, Math.min(1, sum / weightSum));
}

/**
 * Compute separate local and global magnetic powers.
 * Local: first three TFs (1m,5m,15m) weights [1,2,3].
 * Global: last three TFs (1h,4h,1d) weights [3,5,8].
 * Returns tuple [localPower, globalPower] in [-1..1].
 */
export function calcLocalGlobalPower(request: TWAlertDto): [number, number] {
  const bands = timeframeBands(request);
  const local = weightedBandPower(bands.slice(0, 3), [1, 2, 3], request.price);
  const global = weightedBandPower(bands.slice(3, 6), [3, 5, 8], request.price);
  return [local, global];
}
