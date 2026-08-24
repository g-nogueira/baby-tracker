import { type ReactNode, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LIVE_CONTROLLER_STACK_GAP } from './activity-live-controller-layout';
import {
  liveControllerBottomOffset,
  liveControllerReservedSpace,
} from './activity-live-controller-stack-state';

/** Positions one or more persistent activity controllers above the safe area. */
export function ActivityLiveControllerStack({
  children,
  onReservedSpaceChange,
  raised = false,
}: {
  children: ReactNode;
  onReservedSpaceChange?: (height: number) => void;
  raised?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (height === 0) return;
    onReservedSpaceChange?.(liveControllerReservedSpace(insets.bottom, raised, height));
  }, [height, insets.bottom, onReservedSpaceChange, raised]);
  return (
    <View
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      style={[styles.stack, { bottom: liveControllerBottomOffset(insets.bottom, raised) }]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', left: 16, right: 16, gap: LIVE_CONTROLLER_STACK_GAP },
});
