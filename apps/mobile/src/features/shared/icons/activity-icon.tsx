import Svg, { Path } from 'react-native-svg';
import { Image } from 'react-native';
import { useActivityTheme } from '../activity-theme';
import { activityArtwork, monochromeArtwork } from './activity-artwork';

/** Activity artwork on connected surfaces; vector glyphs for universal controls. */
export function ActivityIcon({
  name,
  color = '#FFFFFF',
  size = 24,
  monochrome = false,
}: {
  name: string;
  color?: string;
  size?: number;
  monochrome?: boolean;
}) {
  const theme = useActivityTheme();
  const paths: Record<string, string> = {
    nap: 'M3 18V9 M3 14H21V18 M3 11H8V14 M8 11H18Q21 11 21 14 M13 3H18L13 8H18',
    bedtime: 'M3 16H21 M6 13A6 6 0 0 1 18 13 M6 19H18 M9 22H15',
    night: 'M20 15A9 9 0 0 1 9 4A9 9 0 1 0 20 15Z',
    wake: 'M12 7A5 5 0 1 0 12 17A5 5 0 1 0 12 7 M12 2V4 M12 20V22 M2 12H4 M20 12H22 M5 5L6.5 6.5 M17.5 17.5L19 19 M5 19L6.5 17.5 M17.5 6.5L19 5',
    'night-waking':
      'M7 16H6A4 4 0 1 1 6 8A6 6 0 0 1 18 8A4 4 0 0 1 18 16H16 M13 11L9 17H13L11 22L17 14H13Z',
    nursing: 'M8 4Q2 11 4 16Q6 21 11 19 M16 4Q22 11 20 16Q18 21 13 19 M8 13H9 M15 13H16',
    diaper: 'M4 5H20L19 16Q12 23 5 16Z M4 9L9 11 M20 9L15 11 M8 6V9 M16 6V9',
    medicine: 'M8 7V3H16V7 M7 7H17V21H7Z M9 14H15 M12 11V17',
    home: 'M3 11L12 3L21 11 M5 10V21H10V15H14V21H19V10',
    music: 'M9 18V5L21 3V16 M9 8L21 6 M9 18A3 3 0 1 1 9 17 M21 16A3 3 0 1 1 21 15',
    books: 'M3 4H8V21H3Z M10 4H15V21H10Z M17 5L21 4L24 20L20 21Z',
    chart: 'M3 13H8V21H3Z M9 8H14V21H9Z M15 3H20V21H15Z',
    baby: 'M8 6Q12 2 16 6L18 8L13 13L7 12L5 9Z M7 12Q2 13 4 18Q7 22 12 18L13 13 M10 6L16 12',
    pacifier:
      'M9 10V5A3 3 0 0 1 15 5V10 M6 10Q12 8 18 10Q19 13 15 14H9Q5 13 6 10 M9 14A4 4 0 1 0 15 14',
    list: 'M9 5H21 M9 12H21 M9 19H21 M3 5H3.1 M3 12H3.1 M3 19H3.1',
    footprints:
      'M8 4C4 4 4 10 6 13C9 16 12 12 11 9C10 7 11 4 8 4 M6 16C3 15 3 19 5 20C8 22 10 18 8 17Z M17 8C13 8 14 14 16 17C18 20 22 16 21 13C20 11 20 8 17 8 M15 19C12 18 12 22 15 23C18 24 19 21 17 20Z',
    log: 'M5 3H19V21H5Z M8 7H16 M8 11H16 M8 15H13',
    trash: 'M4 6H20 M9 6V3H15V6 M6 6L7 21H17L18 6 M10 10V17 M14 10V17',
    plus: 'M12 4V20 M4 12H20',
    settings: 'M4 7H20 M4 17H20 M8 4V10 M16 14V20',
    more: 'M4 12H4.1 M12 12H12.1 M20 12H20.1',
    close: 'M6 6L18 18 M18 6L6 18',
    stop: 'M6 6H18V18H6Z',
    pause: 'M8 5V19 M16 5V19',
    play: 'M8 5L19 12L8 19Z',
    'play-filled': 'M7 4L20 12L7 20Z',
    'pause-filled': 'M6 4H10V20H6Z M14 4H18V20H14Z',
    check: 'M4 12L9 17L20 6',
    'home-filled': 'M2 11L12 2L22 11H20V22H14V15H10V22H4V11Z',
    moon: 'M20 15A9 9 0 0 1 9 4A9 9 0 1 0 20 15Z',
    sun: 'M12 7A5 5 0 1 0 12 17A5 5 0 1 0 12 7 M12 2V4 M12 20V22 M2 12H4 M20 12H22 M5 5L6.5 6.5 M17.5 17.5L19 19 M5 19L6.5 17.5 M17.5 6.5L19 5',
    cycle: 'M5 19A9 9 0 1 1 19 19',
    down: 'M6 9L12 15L18 9',
    'chevron-right': 'M9 5L16 12L9 19',
    back: 'M20 12H4 M10 6L4 12L10 18',
    rewind: 'M5 9V3 M5 9H11 M5 9A8 8 0 1 1 4 15',
    forward: 'M19 9V3 M19 9H13 M19 9A8 8 0 1 0 20 15',
  };
  const aliases: Record<string, string> = {
    z: 'nap',
    '☾': 'night',
    '☀': 'wake',
    'wake-up': 'wake',
    '↯': 'night-waking',
    N: 'nursing',
    D: 'diaper',
    '+': 'medicine',
    '■': 'stop',
    '▶': 'play',
    '✓': 'check',
  };
  const kind = aliases[name] ?? name;
  const artwork = monochrome
    ? (monochromeArtwork[kind as keyof typeof monochromeArtwork] ??
      activityArtwork[kind as keyof typeof activityArtwork])
    : activityArtwork[kind as keyof typeof activityArtwork];
  if (theme.night && artwork) {
    return (
      <Image
        source={typeof artwork === 'string' ? { uri: artwork } : artwork}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path
        d={paths[kind] ?? paths.check}
        transform={kind === 'pacifier' ? 'rotate(40 12 12)' : undefined}
        fill={kind === 'stop' || kind.endsWith('-filled') ? color : 'none'}
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
