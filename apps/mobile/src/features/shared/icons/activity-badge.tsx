import { StyleSheet, View } from 'react-native';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { ActivityIcon } from './activity-icon';

/** Original line artwork with a quiet ring, shared by actions, records and drawers. */
export function ActivityBadge({
  icon,
  color,
  size = 48,
  active = false,
  outlined = true,
}: {
  icon: string;
  color: string;
  size?: number;
  active?: boolean;
  outlined?: boolean;
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
          backgroundColor: `${color}${theme.night ? '20' : '12'}`,
          borderColor: active ? color : `${color}70`,
          borderStyle: active ? 'dotted' : 'solid',
          borderWidth: active ? 2 : outlined ? 1.5 : 0,
        },
      ]}
    >
      <ActivityIcon name={icon} color={color} size={size * 0.45} />
    </View>
  );
}
const styles = StyleSheet.create({ badge: { alignItems: 'center', justifyContent: 'center' } });
