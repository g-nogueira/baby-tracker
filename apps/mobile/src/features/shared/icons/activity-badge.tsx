import Svg, { Circle } from 'react-native-svg';
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
          borderWidth: active && theme.night ? 0 : active ? 2 : outlined ? 1.5 : 0,
          shadowColor: color,
          shadowOpacity: theme.night && active ? 0.55 : 0,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 },
        },
      ]}
    >
      {active && theme.night ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: -8, top: -8, width: size + 16, height: size + 16 }}
        >
          <Svg width={size + 16} height={size + 16} viewBox="0 0 96 96" accessibilityElementsHidden>
            {[0.035, 0.06, 0.1].map((opacity, index) => (
              <Circle
                key={opacity}
                cx={48}
                cy={48}
                r={37 + index}
                fill="none"
                stroke={color}
                strokeWidth={12 - index * 3}
                opacity={opacity}
              />
            ))}
            <Circle
              cx={48}
              cy={48}
              r={37}
              fill="none"
              stroke={color}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeDasharray="0.1 4.75"
            />
          </Svg>
        </View>
      ) : null}
      <ActivityIcon
        name={icon}
        color={color}
        size={size * (artworkScale ?? (theme.night ? 0.65 : 0.45))}
      />
    </View>
  );
}
const styles = StyleSheet.create({ badge: { alignItems: 'center', justifyContent: 'center' } });
