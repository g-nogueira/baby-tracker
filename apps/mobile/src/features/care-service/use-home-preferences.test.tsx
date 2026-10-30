import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHomePreferences } from './use-home-preferences';
import { defaultHomePreferences, type HomePreferences } from './home-preferences';
const storage = vi.hoisted(() => ({
  value: null as HomePreferences | null,
  fail: false,
  saves: [] as HomePreferences[],
}));
vi.mock('./home-preferences-store', () => ({
  homePreferencesStore: {
    load: async () => storage.value ?? defaultHomePreferences,
    save: async (p: HomePreferences) => {
      if (storage.fail) throw new Error('unavailable');
      storage.saves.push(p);
      storage.value = p;
    },
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer;
let state: ReturnType<typeof useHomePreferences>;
function Probe() {
  state = useHomePreferences();
  return null;
}
beforeEach(() => {
  storage.value = null;
  storage.fail = false;
  storage.saves = [];
});
afterEach(async () => {
  await act(async () => renderer.unmount());
});
it('saves ordered UI changes and reloads them on a fresh mount', async () => {
  await act(async () => {
    renderer = create(<Probe />);
  });
  expect(state.ready).toBe(true);
  const first = { ...defaultHomePreferences, bedtimeFromHour: 18 };
  const second = { ...first, actions: ['medicine'] as 'medicine'[] };
  await act(async () => {
    state.change(first);
    state.change(second);
  });
  expect(storage.saves).toEqual([first, second]);
  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = create(<Probe />);
  });
  expect(state.value).toEqual(second);
});
it('reports persistence errors and allows a later preference change to retry', async () => {
  await act(async () => {
    renderer = create(<Probe />);
  });
  storage.fail = true;
  await act(async () => state.change({ ...defaultHomePreferences, bedtimeFromHour: 18 }));
  expect(state.error).toContain('could not be saved');
  storage.fail = false;
  await act(async () => state.change({ ...defaultHomePreferences, bedtimeFromHour: 19 }));
  expect(state.error).toBeNull();
  expect(storage.value?.bedtimeFromHour).toBe(19);
});
