import { Pressable, View } from 'react-native';
import { Text } from './tracking-text';
import { ActivityIcon } from './icons/activity-icon';
import { useActivityTheme } from './activity-theme';

/** Playback controls share a visible label and a full circular touch target. */
export function OutlinedRoundAction({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useActivityTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ alignItems: 'center', gap: 6, opacity: disabled ? 0.45 : 1 }}
    >
      <View
        style={{
          width: 78,
          height: 78,
          borderRadius: 39,
          borderWidth: 2,
          borderColor: theme.accent,
          backgroundColor: theme.raised,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIcon name={icon} size={28} color={theme.text} />
      </View>
      <Text style={{ fontSize: 14, color: theme.muted }}>{label.replace(' Nap', '')}</Text>
    </Pressable>
  );
}
