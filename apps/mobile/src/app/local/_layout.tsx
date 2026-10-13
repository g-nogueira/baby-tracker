import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { migrateDatabase } from '@/storage/migrations';

export default function RootLayout() {
  const [initializationError, setInitializationError] = useState<Error | null>(null);
  const handleInitializationError = useCallback((error: Error) => {
    console.error('Local database initialization failed.', error);
    setInitializationError(error);
  }, []);

  if (initializationError) {
    return (
      <View accessibilityRole="alert" style={styles.errorScreen}>
        <Text style={styles.errorTitle}>Baby Tracker couldn’t open its local data.</Text>
        <Text style={styles.errorText}>
          Close and reopen the app. If this continues, update it.
        </Text>
        {__DEV__ ? <Text style={styles.errorDetail}>{initializationError.message}</Text> : null}
      </View>
    );
  }

  return (
    <SQLiteProvider
      databaseName="baby-tracker.db"
      onError={handleInitializationError}
      onInit={migrateDatabase}
    >
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </SQLiteProvider>
  );
}

const styles = StyleSheet.create({
  errorScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
    backgroundColor: '#F7F4EF',
  },
  errorTitle: { color: '#292724', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  errorText: { color: '#746F68', fontSize: 15, textAlign: 'center' },
  errorDetail: { color: '#746F68', fontFamily: 'monospace', fontSize: 12, textAlign: 'center' },
});
