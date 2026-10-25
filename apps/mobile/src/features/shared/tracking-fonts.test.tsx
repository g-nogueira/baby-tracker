import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import RootLayout from '../../app/_layout';
import { ActivityThemeContext, nightTheme } from './activity-theme';
import { Text } from './tracking-text';

const fonts = vi.hoisted(() => ({ loaded: false, error: null as Error | null }));
const hide = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('expo-font', () => ({ useFonts: () => [fonts.loaded, fonts.error] }));
vi.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: hide,
}));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'RootView' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider' }));
vi.mock('react-native', () => ({
  Text: 'Text',
  StyleSheet: { flatten: (style: unknown) => style },
}));
vi.mock('expo-router', () => ({
  Stack: () => (
    <ActivityThemeContext.Provider value={nightTheme}>
      <Text style={{ fontWeight: '500' }}>Awake for</Text>
    </ActivityThemeContext.Provider>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  fonts.loaded = false;
  fonts.error = null;
  hide.mockClear();
});

it('keeps the splash visible until bundled fonts finish loading', async () => {
  await act(async () => {
    renderer = create(<RootLayout />);
  });
  expect(renderer?.toJSON()).toBeNull();
  expect(hide).not.toHaveBeenCalled();
  fonts.loaded = true;
  await act(async () => renderer?.update(<RootLayout />));
  expect(hide).toHaveBeenCalledOnce();
  expect(renderer?.root.findByType('Text' as never).props.style).toContainEqual({
    fontFamily: 'Saans-Medium',
    fontWeight: 'normal',
    fontStyle: 'normal',
  });
});

it('opens tracking with the system typeface if font loading fails', async () => {
  fonts.error = new Error('Synthetic font failure');
  await act(async () => {
    renderer = create(<RootLayout />);
  });
  expect(hide).toHaveBeenCalledOnce();
  const style = renderer?.root.findByType('Text' as never).props.style;
  expect(style.filter(Boolean)).toEqual([{ fontWeight: '500' }]);
});
