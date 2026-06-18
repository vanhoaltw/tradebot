import { roundToStep, roundToTick } from './precision';

describe('roundToStep (floor to lot)', () => {
  it('floors quantity to the step size', () => {
    expect(roundToStep(0.123456, 0.001)).toBe(0.123);
  });

  it('never rounds up', () => {
    expect(roundToStep(1.9999, 1)).toBe(1);
  });

  it('handles floating-point dust (0.3 / 0.1)', () => {
    expect(roundToStep(0.3, 0.1)).toBe(0.3);
  });

  it('returns the value unchanged when step is non-positive', () => {
    expect(roundToStep(5, 0)).toBe(5);
  });
});

describe('roundToTick (round to tick grid)', () => {
  it('rounds price to the nearest tick', () => {
    expect(roundToTick(100.027, 0.01)).toBe(100.03);
  });

  it('rounds down when nearer the lower tick', () => {
    expect(roundToTick(100.024, 0.01)).toBe(100.02);
  });

  it('handles whole-number ticks', () => {
    expect(roundToTick(101.7, 1)).toBe(102);
  });
});
