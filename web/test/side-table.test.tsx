import {render, screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {SideTable} from '../src/side-table.js';

describe('SideTable', () => {
  it('renders Price, Amount and Total per level, best first', () => {
    render(
      <SideTable
        side="bids"
        levels={[
          {price: 64000, amount: 0.5},
          {price: 63999, amount: 1.25},
        ]}
      />,
    );
    const table = screen.getByRole('table', {name: 'Bids'});
    const rows = within(table).getAllByRole('row').slice(1); // skip header
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('64,000.00');
    expect(rows[0].textContent).toContain('0.5000');
    expect(rows[0].textContent).toContain('32,000.00');
    expect(rows[1].textContent).toContain('63,999.00');
  });

  it('labels asks with a visible caption and colors prices by side', () => {
    const {container} = render(
      <SideTable side="asks" levels={[{price: 64001, amount: 1}]} />,
    );
    expect(screen.getByRole('table', {name: 'Asks'})).toBeTruthy();
    const caption = container.querySelector('caption');
    expect(caption?.textContent).toBe('Asks');
    expect(container.querySelector('.price-asks')).toBeTruthy();
    expect(container.querySelector('.depth-asks')).toBeTruthy();
  });

  it('scales depth bars relative to the largest total', () => {
    const {container} = render(
      <SideTable
        side="bids"
        levels={[
          {price: 100, amount: 2}, // total 200 → 100%
          {price: 50, amount: 2}, // total 100 → 50%
        ]}
      />,
    );
    const bars = container.querySelectorAll<HTMLElement>('.depth-bar');
    expect(bars[0].style.width).toBe('100%');
    expect(bars[1].style.width).toBe('50%');
  });

  it('renders zero-width bars when totals are zero', () => {
    const {container} = render(
      <SideTable side="bids" levels={[{price: 100, amount: 0}]} />,
    );
    const bar = container.querySelector<HTMLElement>('.depth-bar');
    expect(bar?.style.width).toBe('0%');
  });

  it('renders an empty body without levels', () => {
    render(<SideTable side="bids" levels={[]} />);
    const table = screen.getByRole('table', {name: 'Bids'});
    expect(within(table).getAllByRole('row')).toHaveLength(1); // header only
  });
});
