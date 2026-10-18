import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { Link } from 'expo-router';
import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { SheetToolbar } from './sheet-toolbar';
import type { useCareTracker } from './use-care-tracker';

export function ProfileSheet({
  model,
  onClose,
}: {
  model: ReturnType<typeof useCareTracker>;
  onClose: () => void;
}) {
  const theme = useActivityTheme();
  const sheet = useRef<TrueSheet>(null);
  return (
    <TrueSheet
      ref={sheet}
      initialDetentIndex={0}
      detents={['auto']}
      scrollable
      draggable
      dismissible
      backgroundColor={theme.surface}
      onDidDismiss={onClose}
      grabberOptions={{ color: theme.muted, width: 42, adaptive: false }}
      accessibilityOptions={{ paneTitle: 'Profile and sync' }}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <SheetToolbar
          label="Profile"
          busy={model.busy}
          onClose={() => void sheet.current?.dismiss()}
        />
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {model.baby?.name}
        </Text>
        <Text style={{ color: theme.muted }}>Shared records · {model.providerName}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh shared records"
          disabled={model.busy || model.refreshing}
          onPress={() => void model.refresh()}
          style={[styles.button, { backgroundColor: theme.field }]}
        >
          <Text style={{ color: theme.accent }}>
            {model.refreshing ? 'Refreshing…' : 'Refresh shared records'}
          </Text>
        </Pressable>
        <View style={styles.links}>
          <Link href="/local" style={[styles.link, { color: theme.muted }]}>
            Separate on-device tracker
          </Link>
          <Pressable
            accessibilityRole="button"
            disabled={model.busy}
            onPress={() => void model.signOut()}
            style={styles.button}
          >
            <Text style={{ color: theme.error }}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </TrueSheet>
  );
}
const styles = StyleSheet.create({
  content: { padding: 24, gap: 16, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '600' },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  links: { gap: 6 },
  link: { padding: 16, textAlign: 'center' },
});
