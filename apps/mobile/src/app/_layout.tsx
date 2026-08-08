import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { migrateDatabase } from '@/storage/migrations';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="baby-tracker.db" onInit={migrateDatabase}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </SQLiteProvider>
  );
}
