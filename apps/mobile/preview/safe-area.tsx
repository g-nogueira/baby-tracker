import type { ReactNode } from 'react';
import { View } from 'react-native';
export const SafeAreaView = View;
export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 16, left: 0 });
export function SafeAreaProvider({ children }: { children: ReactNode; initialMetrics?: unknown }) {
  return children;
}
