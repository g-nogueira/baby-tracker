import { Pressable, StyleSheet, Text, View } from 'react-native';

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
  return (
    <View style={styles.controller}>
      <Pressable
        accessibilityHint="Opens activity controls"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
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
        <View style={styles.stopSquare} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  controller: {
    minHeight: 68,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
  iconCircle: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
  },
  icon: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  copy: { gap: 2 },
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3A3733',
  },
  stopSquare: { width: 16, height: 16, borderRadius: 3, backgroundColor: '#FFFFFF' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
});
