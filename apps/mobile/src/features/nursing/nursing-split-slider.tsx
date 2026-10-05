import { useCallback, useMemo, useRef } from 'react';
import {
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from 'react-native';

import {
  nursingSplitValueForAccessibilityAction,
  nursingSplitValueForDrag,
  nursingSplitValueForPosition,
} from './nursing-split-slider-state';

interface NursingSplitSliderProps {
  accessibilityText: string;
  disabled: boolean;
  maximumValue: number;
  onValueChange: (value: number) => void;
  value: number;
}

/** One-value slider whose remainder is the Nursing Right duration. */
export function NursingSplitSlider({
  accessibilityText,
  disabled,
  maximumValue,
  onValueChange,
  value,
}: NursingSplitSliderProps) {
  const trackWidth = useRef(0);
  const dragStartValue = useRef(value);
  const current = useRef({ disabled, maximumValue, onValueChange, value });
  current.current = { disabled, maximumValue, onValueChange, value };

  const update = useCallback((next: number) => {
    const state = current.current;
    if (!state.disabled && next !== state.value) state.onValueChange(next);
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !current.current.disabled,
        onPanResponderTerminationRequest: () => false,
        onMoveShouldSetPanResponderCapture: (_event, gesture) => {
          return (
            !current.current.disabled &&
            Math.abs(gesture.dx) > 4 &&
            Math.abs(gesture.dx) > Math.abs(gesture.dy)
          );
        },
        onPanResponderGrant: (event) => {
          dragStartValue.current = nursingSplitValueForPosition(
            event.nativeEvent.locationX,
            trackWidth.current,
            current.current.maximumValue,
          );
          update(dragStartValue.current);
        },
        onPanResponderMove: (_event, gesture) => {
          update(
            nursingSplitValueForDrag(
              dragStartValue.current,
              gesture.dx,
              trackWidth.current,
              current.current.maximumValue,
            ),
          );
        },
      }),
    [update],
  );

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (
      event.nativeEvent.actionName !== 'increment' &&
      event.nativeEvent.actionName !== 'decrement'
    ) {
      return;
    }
    update(
      nursingSplitValueForAccessibilityAction(
        current.current.value,
        event.nativeEvent.actionName,
        current.current.maximumValue,
      ),
    );
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    trackWidth.current = event.nativeEvent.layout.width;
  };

  const fillRatio = maximumValue <= 0 ? 0 : Math.min(1, Math.max(0, value / maximumValue));

  return (
    <View
      accessibilityActions={[
        { name: 'increment', label: 'Increase Left duration' },
        { name: 'decrement', label: 'Decrease Left duration' },
      ]}
      accessibilityLabel="Left Nursing duration"
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      accessibilityValue={{
        min: 0,
        max: maximumValue,
        now: value,
        text: accessibilityText,
      }}
      onAccessibilityAction={handleAccessibilityAction}
      onLayout={handleLayout}
      style={[styles.slider, disabled && styles.disabled]}
      {...panResponder.panHandlers}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.fill, { width: `${fillRatio * 100}%` }]} />
        <View style={[styles.thumb, { left: `${fillRatio * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slider: { minHeight: 44, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: '#E7E0D7' },
  fill: { height: 6, borderRadius: 3, backgroundColor: '#B35D7D' },
  thumb: {
    position: 'absolute',
    top: -9,
    width: 24,
    height: 24,
    marginLeft: -12,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    borderRadius: 12,
    backgroundColor: '#B35D7D',
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.86 },
});
