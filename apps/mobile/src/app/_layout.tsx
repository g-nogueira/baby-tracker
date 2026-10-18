import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { TrackingFontsContext } from '@/features/shared/tracking-text';
import regular from '../../assets/napper/Saans-Regular.ttf';
import medium from '../../assets/napper/Saans-Medium.ttf';
import italic from '../../assets/napper/Saans-RegularItalic.ttf';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts({
    'Saans-Regular': regular,
    'Saans-Medium': medium,
    'Saans-RegularItalic': italic,
  });
  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);
  if (!loaded && !error) return null;
  return (
    <TrackingFontsContext.Provider value={loaded}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </TrackingFontsContext.Provider>
  );
}
