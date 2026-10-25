import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../tracking-text';
import { useActivityTheme } from '../activity-theme';
import { ActivityIcon } from '../icons/activity-icon';
import { LIVE_CONTROLLER_MIN_HEIGHT } from './activity-live-controller-layout';

export interface NapProgressControl {
  fraction: number;
  remainingLabel: string;
  estimateLabel: string;
  paused: boolean;
  onTogglePause: () => void;
}

/** A compact timer with a display-only estimate and independent playback controls. */
export function NapLiveController({
  progress,
  elapsedLabel,
  disabled,
  onOpen,
  onStop,
  accessibilityLabel,
  stopAccessibilityLabel,
}: {
  progress: NapProgressControl;
  elapsedLabel: string;
  disabled: boolean;
  onOpen: () => void;
  onStop: () => void;
  accessibilityLabel: string;
  stopAccessibilityLabel: string;
}) {
  const theme = useActivityTheme();
  const foreground = theme.night ? theme.text : '#FFFFFF';
  return (
    <View style={[styles.controller, { backgroundColor: theme.night ? '#2A284F' : '#34313D' }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={`${progress.paused ? 'Nap paused. ' : ''}${progress.estimateLabel}. Opens activity controls`}
        disabled={disabled}
        onPress={onOpen}
        style={[styles.body, disabled && styles.disabled]}
      >
        <View style={styles.artwork}>
          <ActivityIcon name="nap" size={42} />
        </View>
        <View style={styles.copy}>
          <View style={styles.times}>
            <View style={styles.time}>
              <ActivityIcon name="stopwatch" size={16} color={foreground} />
              <Text numberOfLines={1} style={[styles.elapsed, { color: foreground }]}>
                {elapsedLabel}
              </Text>
            </View>
            <View accessible accessibilityLabel={progress.estimateLabel} style={styles.time}>
              <ActivityIcon name="flag" size={14} color={foreground} />
              <Text numberOfLines={1} style={[styles.estimate, { color: foreground }]}>
                {progress.remainingLabel}
              </Text>
            </View>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Estimated nap progress"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: Math.round(progress.fraction * 100),
              text: `${progress.paused ? 'Paused. ' : ''}${progress.estimateLabel}`,
            }}
            style={styles.track}
          >
            <View style={[styles.fill, { width: `${progress.fraction * 100}%` }]} />
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={progress.paused ? 'Resume Nap' : 'Pause Nap'}
        accessibilityState={{ disabled, busy: disabled }}
        disabled={disabled}
        onPress={progress.onTogglePause}
        style={[styles.control, disabled && styles.disabled]}
      >
        <ActivityIcon
          name={progress.paused ? 'play-filled' : 'pause-filled'}
          size={26}
          color={foreground}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={stopAccessibilityLabel}
        accessibilityState={{ disabled, busy: disabled }}
        disabled={disabled}
        onPress={onStop}
        style={[styles.control, disabled && styles.disabled]}
      >
        <View style={[styles.square, { backgroundColor: foreground }]} />
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  controller: {
    height: LIVE_CONTROLLER_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingRight: 6,
  },
  body: {
    flex: 1,
    minWidth: 0,
    height: LIVE_CONTROLLER_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 2,
  },
  artwork: { width: 42, height: 42, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  times: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4 },
  time: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1, minWidth: 0 },
  elapsed: { fontSize: 17, lineHeight: 22, fontWeight: '400', flexShrink: 1 },
  estimate: { fontSize: 14, lineHeight: 22, fontWeight: '400', flexShrink: 1 },
  track: { height: 4, borderRadius: 2, backgroundColor: '#37345F', overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: '#8986FF' },
  control: {
    width: 44,
    minHeight: LIVE_CONTROLLER_MIN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  square: { width: 18, height: 18, borderRadius: 2 },
  disabled: { opacity: 0.45 },
});
