import { describe, expect, it } from 'vitest';

import { homeQuickActionsLayout } from './home-quick-actions-layout';

describe('Home quick-action layout', () => {
  it('keeps two actions spacious without exceeding their intended width', () => {
    expect(homeQuickActionsLayout(320, 2)).toEqual({
      actionWidth: 108,
      circleSize: 56,
      gap: 26,
    });
  });

  it('fits all five eventual activity slots on a narrow phone content width', () => {
    const layout = homeQuickActionsLayout(280, 5);
    expect(layout.actionWidth * 5 + layout.gap * 4).toBeLessThanOrEqual(280);
    expect(layout.circleSize).toBeLessThanOrEqual(layout.actionWidth);
  });
});
