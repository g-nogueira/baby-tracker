import { Text } from '@/features/shared/tracking-text';
import { useActivityTheme, type ActivityTheme } from '@/features/shared/activity-theme';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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
  nursingSides?: {
    left: string;
    right: string;
    active: 'LEFT' | 'RIGHT' | null;
    onLeft: () => void;
    onRight: () => void;
  };
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
  nursingSides,
}: ActivityLiveControllerProps) {
  const theme = useActivityTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.controller}>
      {nursingSides ? (
        <View style={styles.body}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            disabled={disabled}
            onPress={onOpen}
            style={styles.openIcon}
          >
            <ActivityIcon name={icon} color={accentColor} size={34} />
          </Pressable>
          {(['LEFT', 'RIGHT'] as const).map((side) => (
            <Pressable
              key={side}
              accessibilityRole="button"
              accessibilityLabel={`${nursingSides.active === side ? 'Pause' : nursingSides.active === null ? 'Resume' : 'Switch to'} ${side === 'LEFT' ? 'Left' : 'Right'} breast`}
              disabled={disabled}
              onPress={side === 'LEFT' ? nursingSides.onLeft : nursingSides.onRight}
              style={[styles.sidePill, nursingSides.active === side && styles.activeSide]}
            >
              <Text
                style={[styles.sideTime, nursingSides.active === side && styles.activeSideText]}
              >
                {side === 'LEFT' ? `L ${nursingSides.left}` : `R ${nursingSides.right}`}
              </Text>
              <ActivityIcon
                name={nursingSides.active === side ? 'pause' : 'play'}
                size={16}
                color={nursingSides.active === side ? theme.onAccent : theme.muted}
              />
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable
          accessibilityHint="Opens activity controls"
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: disabled }}
          disabled={disabled}
          onPress={onOpen}
          style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        >
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: theme.night ? 'transparent' : accentColor },
            ]}
          >
            <ActivityIcon
              name={icon}
              color={theme.night ? accentColor : '#FFFFFF'}
              size={34}
              monochrome
            />
          </View>
          <View style={styles.copy}>
            {!theme.night ? <Text style={styles.title}>{activityLabel}</Text> : null}
            <Text style={styles.value}>{elapsedLabel}</Text>
            {subtitle === undefined ? null : <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
        </Pressable>
      )}
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
      gap: 6,
      paddingHorizontal: 10,
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
    openIcon: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    sidePill: {
      flex: 1,
      height: 44,
      minWidth: 0,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      borderRadius: 24,
    },
    sideTime: { color: theme.muted, fontSize: 14, fontVariant: ['tabular-nums'] },
    activeSide: { backgroundColor: '#999BFF' },
    activeSideText: { color: theme.onAccent },
    icon: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    title: { color: '#D8D2CC', fontSize: 12, fontWeight: '700' },
    value: {
      color: '#FFFFFF',
      fontSize: theme.night ? 18 : 22,
      fontWeight: '500',
      fontVariant: ['tabular-nums'],
    },
    subtitle: { color: '#D8D2CC', fontSize: 11 },
    stop: {
      minHeight: LIVE_CONTROLLER_MIN_HEIGHT,
      width: theme.night ? 44 : 58,
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
