import { useId } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { ActivityIcon } from './icons/activity-icon';
import { useActivityTheme } from './activity-theme';

/** Shared floating primary control; its accessible label always names the real operation. */
export function RoundAction({
  label,
  icon = 'check',
  onPress,
  disabled = false,
  size = 80,
}: {
  label: string;
  icon?: string;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
}) {
  const theme = useActivityTheme();
  const id = `action${useId().replaceAll(':', '')}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.accent,
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        shadowColor: '#8587FF',
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 0 },
      })}
    >
      {theme.night ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          <Svg width={size} height={size} viewBox="0 0 80 80" accessibilityElementsHidden>
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#8587FF" />
                <Stop offset="1" stopColor="#C4C4FF" />
              </LinearGradient>
            </Defs>
            <Circle cx={40} cy={40} r={39} fill={`url(#${id})`} stroke="#B2B4FF" strokeWidth={2} />
          </Svg>
        </View>
      ) : null}
      <ActivityIcon name={icon} size={size * 0.36} color={theme.text} />
    </Pressable>
  );
}
