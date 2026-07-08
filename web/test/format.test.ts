import {describe, expect, it} from 'vitest';

import {formatAmount, formatPrice, formatTotal} from '../src/format.js';

describe('format', () => {
  it('formats prices with 2 decimals and thousands separators', () => {
    expect(formatPrice(64123.5)).toBe('64,123.50');
    expect(formatPrice(0.129)).toBe('0.13');
  });

  it('formats amounts with 4 decimals', () => {
    expect(formatAmount(1.23456)).toBe('1.2346');
    expect(formatAmount(2)).toBe('2.0000');
  });

  it('computes and formats totals at the render boundary', () => {
    expect(formatTotal(64000, 0.5)).toBe('32,000.00');
    expect(formatTotal(0.1, 0.2)).toBe('0.02');
  });
});
