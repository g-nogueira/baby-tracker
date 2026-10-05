import Svg, { Path } from 'react-native-svg';

/** Small, consistent line icons; all actions retain explicit accessibility labels. */
export function ActivityIcon({
  name,
  color = '#FFFFFF',
  size = 24,
}: {
  name: string;
  color?: string;
  size?: number;
}) {
  const paths: Record<string, string> = {
    nap: 'M3 18V9 M3 14H21V18 M3 11H8V14 M8 11H18Q21 11 21 14 M13 3H18L13 8H18',
    night: 'M20 15A9 9 0 0 1 9 4A9 9 0 1 0 20 15Z',
    wake: 'M12 7A5 5 0 1 0 12 17A5 5 0 1 0 12 7 M12 2V4 M12 20V22 M2 12H4 M20 12H22 M5 5L6.5 6.5 M17.5 17.5L19 19 M5 19L6.5 17.5 M17.5 6.5L19 5',
    'night-waking':
      'M3 13Q7 6 12 6Q17 6 21 13Q17 18 12 18Q7 18 3 13Z M12 10A3 3 0 1 0 12 16A3 3 0 1 0 12 10',
    nursing: 'M8 4Q2 11 4 16Q6 21 11 19 M16 4Q22 11 20 16Q18 21 13 19 M8 13H9 M15 13H16',
    diaper: 'M4 5H20L19 16Q12 23 5 16Z M4 9L9 11 M20 9L15 11 M8 6V9 M16 6V9',
    medicine: 'M8 7V3H16V7 M7 7H17V21H7Z M9 14H15 M12 11V17',
    stop: 'M6 6H18V18H6Z',
    play: 'M8 5L19 12L8 19Z',
    check: 'M4 12L9 17L20 6',
  };
  const aliases: Record<string, string> = {
    z: 'nap',
    '☾': 'night',
    '☀': 'wake',
    '↯': 'night-waking',
    N: 'nursing',
    D: 'diaper',
    '+': 'medicine',
    '■': 'stop',
    '▶': 'play',
    '✓': 'check',
  };
  const kind = aliases[name] ?? name;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path
        d={paths[kind] ?? paths.check}
        fill={kind === 'stop' ? color : 'none'}
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
