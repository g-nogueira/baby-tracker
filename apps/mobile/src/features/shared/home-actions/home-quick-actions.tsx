import { ActivityBadge } from '@/features/shared/icons/activity-badge';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { homeQuickActionsLayout } from './home-quick-actions-layout';

export interface HomeQuickAction {
  id: string;
  label: string;
  meta: string;
  icon: string;
  color: string;
  disabled: boolean;
  disabledReason: string | null;
  active?: boolean;
  onPress: () => void;
}

/** Renders ordered Home action slots without owning activity state. */
export function HomeQuickActions({ actions }: { actions: readonly HomeQuickAction[] }) {
  const { width } = useWindowDimensions();
  const theme = useActivityTheme();
  const [containerWidth, setContainerWidth] = useState(Math.min(440, width - 32));
  const layout = homeQuickActionsLayout(containerWidth, actions.length);
  return (
    <View
      accessibilityLabel="Quick actions"
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
      style={[styles.row, { gap: layout.gap }]}
    >
      {actions.map((action) => (
        <Pressable
          accessibilityHint={action.disabledReason ?? `Opens ${action.label} controls`}
          accessibilityLabel={
            action.disabledReason === null
              ? `${action.label}, ${action.meta}`
              : `${action.label} unavailable. ${action.disabledReason}`
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: action.disabled }}
          disabled={action.disabled}
          key={action.id}
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.action,
            containerWidth > 0 && { width: layout.actionWidth },

            action.disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <ActivityBadge
            icon={action.icon}
            color={action.color}
            size={layout.circleSize}
            active={action.active}
          />

          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.meta, { color: theme.muted }]}
          >
            {action.meta}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 84,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  action: {
    width: 108,
    minHeight: 80,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    borderRadius: 18,
  },
  active: { backgroundColor: '#EEEAF9' },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#40377C',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  icon: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  label: { color: '#292724', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  meta: { color: '#746F68', fontSize: 12, textAlign: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
});
