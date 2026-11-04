import { D, floorToStep } from './money';

describe('floorToStep', () => {
  it('floors to an exact multiple of the step without float drift', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; exact math must yield 0.3
    expect(floorToStep(D(0.1 + 0.2), 0.1).toNumber()).toBe(0.3);
  });

  it('floors down a quantity between steps', () => {
    expect(floorToStep(D('1.2345'), 0.001).toFixed()).toBe('1.234');
  });

  it('returns zero for quantities below one step', () => {
    expect(floorToStep(D('0.0004'), 0.001).toNumber()).toBe(0);
  });

  it('returns the value unchanged when the step is zero or missing', () => {
    expect(floorToStep(D('1.23'), 0).toFixed()).toBe('1.23');
  });
});
