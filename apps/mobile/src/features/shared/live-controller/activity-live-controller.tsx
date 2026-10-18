import { useActivityTheme, type ActivityTheme } from '@/features/shared/activity-theme';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LIVE_CONTROLLER_MIN_HEIGHT } from './activity-live-controller-layout';

interface ActivityLiveControllerProps {
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
  const theme = useActivityTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
          <ActivityIcon name={icon} />
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
        <View style={styles.stopSquare} />
      </Pressable>
    </View>
  );
}

const createStyles = (theme: ActivityTheme) =>
  StyleSheet.create({
    controller: {
      minHeight: LIVE_CONTROLLER_MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'stretch',
      overflow: 'hidden',
      borderRadius: 24,
      backgroundColor: theme.night ? theme.raised : '#34313D',
      shadowColor: '#000000',
      shadowOpacity: 0.1,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    body: {
      minHeight: LIVE_CONTROLLER_MIN_HEIGHT,
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
      fontSize: 22,
      fontWeight: '500',
      fontVariant: ['tabular-nums'],
    },
    subtitle: { color: '#D8D2CC', fontSize: 11 },
    stop: {
      minHeight: LIVE_CONTROLLER_MIN_HEIGHT,
      width: 58,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    stopSquare: { width: 16, height: 16, borderRadius: 3, backgroundColor: '#FFFFFF' },
    actionIcon: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.78 },
  });
