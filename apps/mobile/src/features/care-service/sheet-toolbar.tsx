import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { useActivityTheme } from '@/features/shared/activity-theme';

/** Confirmation stays inside the drawer and never advances the reviewed record revision. */
export function SheetToolbar({
  label,
  busy,
  onClose,
  onRemove,
}: {
  label: string;
  busy: boolean;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const theme = useActivityTheme();
  const [confirming, setConfirming] = useState(false);
  const reviewedRemoval = useRef(onRemove);
  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        {onRemove ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label}`}
            disabled={busy}
            onPress={() => {
              reviewedRemoval.current = onRemove;
              setConfirming(true);
            }}
            style={[styles.icon, { backgroundColor: theme.raised }]}
          >
            <ActivityIcon name="trash" color={theme.muted} size={21} />
          </Pressable>
        ) : (
          <View style={styles.icon} />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${label} drawer`}
          disabled={busy}
          onPress={onClose}
          style={[styles.icon, { backgroundColor: theme.raised }]}
        >
          <ActivityIcon name="close" color={theme.muted} size={20} />
        </Pressable>
      </View>
      {confirming ? (
        <View style={[styles.confirmation, { backgroundColor: theme.field }]}>
          <Text accessibilityRole="alert" style={[styles.message, { color: theme.text }]}>
            Remove this {label.toLowerCase()} from shared history?
          </Text>
          <View style={styles.buttons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel removal"
              disabled={busy}
              onPress={() => setConfirming(false)}
              style={styles.confirmButton}
            >
              <Text style={{ color: theme.muted }}>Keep record</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Confirm remove ${label}`}
              disabled={busy}
              onPress={() => reviewedRemoval.current?.()}
              style={[styles.confirmButton, { backgroundColor: theme.error }]}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 12, zIndex: 2 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  icon: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  confirmation: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 52,
    zIndex: 3,
    padding: 16,
    gap: 14,
    borderRadius: 20,
  },
  message: { fontSize: 15, lineHeight: 21 },
  buttons: { flexDirection: 'row', gap: 10 },
  confirmButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  removeText: { color: '#FFFFFF', fontWeight: '600' },
});
