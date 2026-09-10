import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LIVE_CONTROLLER_MIN_HEIGHT } from './activity-live-controller-layout';

interface ActivityLiveControllerProps {
  actionIcon?: string;
  accentColor: string;
  accessibilityLabel: string;
  activityLabel: string;
  disabled: boolean;
  elapsedLabel: string;
  icon: string;
  onOpen: () => void;
  onStop: () => void;
  stopAccessibilityLabel: string;
  subtitle?: string;
}

/**
 * Displays an active activity with elapsed time and controls for opening or stopping it.
 *
 * @param accessibilityLabel - Accessibility label for the activity control
 * @param stopAccessibilityLabel - Accessibility label for the stop control
 * @param subtitle - Optional supporting text displayed below the elapsed time
 * @returns The rendered activity live controller
 */
export function ActivityLiveController({
  actionIcon,
  accentColor,
  accessibilityLabel,
  activityLabel,
  disabled,
  elapsedLabel,
  icon,
  onOpen,
  onStop,
  stopAccessibilityLabel,
  subtitle,
}: ActivityLiveControllerProps) {
  return (
    <View style={styles.controller}>
      <Pressable
        accessibilityHint="Opens activity controls"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: disabled }}
        disabled={disabled}
        onPress={onOpen}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <View style={[styles.iconCircle, { backgroundColor: accentColor }]}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{activityLabel}</Text>
          <Text style={styles.value}>{elapsedLabel}</Text>
          {subtitle === undefined ? null : <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={stopAccessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ busy: disabled, disabled }}
        disabled={disabled}
        onPress={onStop}
        style={({ pressed }) => [
          styles.stop,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {actionIcon === undefined ? (
          <View style={styles.stopSquare} />
        ) : (
          <Text style={styles.actionIcon}>{actionIcon}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  controller: {
    minHeight: LIVE_CONTROLLER_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: '#292724',
    shadowColor: '#000000',
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  body: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  iconCircle: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    flexShrink: 0,
  },
  icon: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: '#D8D2CC', fontSize: 12, fontWeight: '700' },
  value: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  subtitle: { color: '#D8D2CC', fontSize: 11 },
  stop: {
    width: 66,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3A3733',
  },
  stopSquare: { width: 16, height: 16, borderRadius: 3, backgroundColor: '#FFFFFF' },
  actionIcon: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
});
