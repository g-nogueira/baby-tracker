import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { ActivityBadge } from '@/features/shared/icons/activity-badge';
import type { HomeQuickAction } from '@/features/shared/home-actions/home-quick-actions';

/** Choose a supported action, then hand off only after native dismissal completes. */
export function ActivityMenuSheet({
  actions,
  onPast,
  onClose,
}: {
  actions: readonly HomeQuickAction[];
  onPast: () => void;
  onClose: () => void;
}) {
  const theme = useActivityTheme();
  const sheet = useRef<TrueSheet>(null);
  const pending = useRef<(() => void) | null>(null);
  const choose = (action: () => void) => {
    if (pending.current) return;
    pending.current = action;
    void sheet.current?.dismiss().catch(() => {
      pending.current = null;
    });
  };
  return (
    <TrueSheet
      ref={sheet}
      initialDetentIndex={0}
      detents={['auto', 0.8]}
      scrollable
      draggable
      dismissible
      backgroundColor={theme.surface}
      accessibilityOptions={{ paneTitle: 'Add activity', grabberLabel: 'Add activity drawer' }}
      onDidDismiss={() => {
        onClose();
        const action = pending.current;
        pending.current = null;
        action?.();
      }}
    >
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40, gap: 24 }}>
        <Text
          accessibilityRole="header"
          style={{ color: theme.text, fontSize: 24, textAlign: 'center' }}
        >
          Add activity
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16 }}>
          {actions.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              accessibilityLabel={`Track ${action.label}`}
              disabled={action.disabled}
              onPress={() => choose(action.onPress)}
              style={{
                width: 88,
                minHeight: 108,
                alignItems: 'center',
                gap: 8,
                opacity: action.disabled ? 0.4 : 1,
              }}
            >
              <ActivityBadge icon={action.icon} color={action.color} size={56} />
              <Text style={{ color: theme.muted, textAlign: 'center', fontSize: 14 }}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add past activity"
          onPress={() => choose(onPast)}
          style={{
            minHeight: 48,
            borderRadius: 24,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: theme.field,
          }}
        >
          <Text style={{ color: theme.muted, fontSize: 16 }}>Add past activity</Text>
        </Pressable>
      </ScrollView>
    </TrueSheet>
  );
}
