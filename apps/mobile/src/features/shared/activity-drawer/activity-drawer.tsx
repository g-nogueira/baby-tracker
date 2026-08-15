import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AccessibilityActionEvent,
  AccessibilityInfo,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {
  type ActivityDrawerDecision,
  type ActivityDrawerMode,
  decideActivityDrawerAccessibilityAction,
  decideActivityDrawerGesture,
  decideActivityDrawerHandlePress,
  initialActivityDrawerState,
} from './activity-drawer-state';

interface ActivityDrawerRenderState {
  expanded: boolean;
}

interface ActivityDrawerProps {
  activityLabel: string;
  children: (state: ActivityDrawerRenderState) => ReactNode;
  mode: ActivityDrawerMode;
  onDismiss: () => void;
}

export function ActivityDrawer({ activityLabel, children, mode, onDismiss }: ActivityDrawerProps) {
  const [drawerState, setDrawerState] = useState(() => initialActivityDrawerState(mode));
  const [reduceMotion, setReduceMotion] = useState(false);
  const translation = useRef(new Animated.Value(0)).current;
  const expanded = drawerState === 'expanded';

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    setDrawerState(initialActivityDrawerState(mode));
    translation.setValue(0);
  }, [mode, translation]);

  const settleDrawer = useCallback(() => {
    if (reduceMotion) {
      translation.setValue(0);
      return;
    }
    Animated.spring(translation, {
      toValue: 0,
      damping: 24,
      stiffness: 260,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, translation]);

  const dismissDrawer = useCallback(() => {
    if (reduceMotion) {
      onDismiss();
      return;
    }
    Animated.timing(translation, {
      toValue: 700,
      duration: 180,
      useNativeDriver: true,
    }).start(onDismiss);
  }, [onDismiss, reduceMotion, translation]);

  const applyDecision = useCallback(
    (decision: ActivityDrawerDecision) => {
      if (decision === 'dismiss') {
        dismissDrawer();
        return;
      }
      if (decision === 'expand') setDrawerState('expanded');
      if (decision === 'collapse') setDrawerState('collapsed');
      settleDrawer();
    },
    [dismissDrawer, settleDrawer],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          const upwardResistance = expanded ? 0.12 : 0.22;
          translation.setValue(gesture.dy < 0 ? gesture.dy * upwardResistance : gesture.dy);
        },
        onPanResponderRelease: (_event, gesture) => {
          applyDecision(
            decideActivityDrawerGesture(drawerState, { dy: gesture.dy, vy: gesture.vy }),
          );
        },
        onPanResponderTerminate: settleDrawer,
      }),
    [applyDecision, drawerState, expanded, settleDrawer, translation],
  );

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    applyDecision(
      decideActivityDrawerAccessibilityAction(drawerState, event.nativeEvent.actionName),
    );
  };

  const handleLabel = `${activityLabel} controls ${expanded ? 'expanded' : 'collapsed'}`;
  const handleHint = expanded
    ? 'Tap, swipe down, or decrease to collapse controls'
    : 'Tap, swipe up, or increase to expand; swipe down or decrease to close controls';

  return (
    <Modal animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onDismiss} transparent>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel={`Close ${activityLabel.toLocaleLowerCase()} controls`}
          accessibilityRole="button"
          onPress={onDismiss}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[styles.sheet, { transform: [{ translateY: translation }] }]}
        >
          <Pressable
            accessibilityActions={[
              { name: 'increment', label: `Expand ${activityLabel} controls` },
              {
                name: 'decrement',
                label: expanded
                  ? `Collapse ${activityLabel} controls`
                  : `Close ${activityLabel} controls`,
              },
            ]}
            accessibilityHint={handleHint}
            accessibilityLabel={handleLabel}
            accessibilityRole="adjustable"
            onAccessibilityAction={handleAccessibilityAction}
            onPress={() => applyDecision(decideActivityDrawerHandlePress(drawerState))}
            style={styles.handleTarget}
            {...panResponder.panHandlers}
          >
            <View style={styles.handle} />
          </Pressable>
          {children({ expanded })}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(35, 31, 28, 0.38)' },
  sheet: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 30,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -5 },
    elevation: 12,
  },
  handleTarget: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#C9C2B9' },
});
