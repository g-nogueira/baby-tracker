import { StyleSheet, View } from 'react-native';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { ActivityIcon } from './activity-icon';

/** Supplied activity artwork with the running/completed record ring. */
export function ActivityBadge({
  icon,
  color,
  size = 48,
  active = false,
  outlined = true,
  artworkScale,
  backgroundColor,
}: {
  icon: string;
  color: string;
  size?: number;
  active?: boolean;
  outlined?: boolean;
  artworkScale?: number;
  backgroundColor?: string;
}) {
  const theme = useActivityTheme();
  return (
    <View
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: backgroundColor ?? (theme.night ? 'transparent' : `${color}12`),
          borderColor: active ? color : `${color}70`,
          borderStyle: active ? 'dotted' : 'solid',
          borderWidth: active ? 2 : outlined ? 1.5 : 0,
          shadowColor: color,
          shadowOpacity: theme.night && active ? 0.55 : 0,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 },
        },
      ]}
    >
      <ActivityIcon
        name={icon}
        color={color}
        size={size * (artworkScale ?? (theme.night ? 0.82 : 0.45))}
      />
    </View>
  );
}
const styles = StyleSheet.create({ badge: { alignItems: 'center', justifyContent: 'center' } });
