import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type AccessibilityActionEvent,
  AccessibilityInfo,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  type ActivityDrawerDecision,
  type ActivityDrawerMode,
  activityDrawerBottomPadding,
  activityDrawerScrollableContentMaxHeight,
  decideActivityDrawerAccessibilityAction,
  decideActivityDrawerGesture,
  decideActivityDrawerHandlePress,
  initialActivityDrawerState,
  shouldActivityDrawerClaimSurfaceGesture,
} from './activity-drawer-state';

interface ActivityDrawerRenderState {
  expanded: boolean;
}

interface ActivityDrawerProps {
  activityLabel: string;
  children: (state: ActivityDrawerRenderState) => ReactNode;
  mode: ActivityDrawerMode;
  onDismiss: () => void;
  scrollContent?: boolean;
}

/**
 * Renders an accessible, expandable activity controls drawer.
 *
 * @param activityLabel - Label identifying the activity whose controls are displayed
 * @param children - Render function receiving whether the drawer is expanded
 * @param mode - Initial presentation mode for the drawer
 * @param onDismiss - Called when the drawer is dismissed
 */
export function ActivityDrawer({
  activityLabel,
  children,
  mode,
  onDismiss,
  scrollContent = false,
}: ActivityDrawerProps) {
  const onDismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  const insets = useSafeAreaInsets();
  const viewport = useWindowDimensions();
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
      onDismissRef.current();
      return;
    }
    Animated.timing(translation, {
      toValue: 700,
      duration: 180,
      useNativeDriver: true,
    }).start(() => onDismissRef.current());
  }, [reduceMotion, translation]);

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

  const scrollOffset = useRef(0);
  const gestureState = useRef({
    drawerState,
    expanded,
    scrollContent,
    applyDecision,
    settleDrawer,
  });
  gestureState.current = { drawerState, expanded, scrollContent, applyDecision, settleDrawer };
  const handlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_event, gesture) => {
          translation.setValue(gesture.dy < 0 ? gesture.dy * 0.15 : gesture.dy);
        },
        onPanResponderRelease: (_event, gesture) => {
          const state = gestureState.current;
          state.applyDecision(
            Math.abs(gesture.dy) < 6 && Math.abs(gesture.dx) < 6
              ? decideActivityDrawerHandlePress(state.drawerState)
              : decideActivityDrawerGesture(state.drawerState, gesture),
          );
        },
        onPanResponderTerminate: () => gestureState.current.settleDrawer(),
      }),
    [translation],
  );

  const surfacePanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) => {
          const state = gestureState.current;
          return (
            shouldActivityDrawerClaimSurfaceGesture(
              state.drawerState,
              state.scrollContent,
              gesture,
            ) ||
            (state.expanded &&
              scrollOffset.current <= 0 &&
              gesture.dy > 8 &&
              Math.abs(gesture.dy) > Math.abs(gesture.dx))
          );
        },
        onPanResponderMove: (_event, gesture) => {
          translation.setValue(gesture.dy < 0 ? gesture.dy * 0.15 : gesture.dy);
        },
        onPanResponderRelease: (_event, gesture) => {
          const state = gestureState.current;
          state.applyDecision(decideActivityDrawerGesture(state.drawerState, gesture));
        },
        onPanResponderTerminate: () => gestureState.current.settleDrawer(),
      }),
    [translation],
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
  const content = children({ expanded });

  return (
    <Modal animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onDismiss} transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <Pressable
          accessibilityLabel={`Close ${activityLabel.toLocaleLowerCase()} controls`}
          accessibilityRole="button"
          onPress={onDismiss}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              paddingBottom: activityDrawerBottomPadding(insets.bottom),
              transform: [{ translateY: translation }],
            },
          ]}
          {...surfacePanResponder.panHandlers}
        >
          <View
            accessibilityActions={
              expanded
                ? [{ name: 'decrement', label: `Collapse ${activityLabel} controls` }]
                : [
                    { name: 'increment', label: `Expand ${activityLabel} controls` },
                    { name: 'decrement', label: `Close ${activityLabel} controls` },
                  ]
            }
            accessibilityHint={handleHint}
            accessibilityLabel={handleLabel}
            accessibilityRole="adjustable"
            onAccessibilityAction={handleAccessibilityAction}
            onAccessibilityTap={() => applyDecision(decideActivityDrawerHandlePress(drawerState))}
            style={styles.handleTarget}
            {...handlePanResponder.panHandlers}
          >
            <View pointerEvents="none" style={styles.handle} />
          </View>
          {scrollContent ? (
            <ScrollView
              alwaysBounceVertical={false}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              key={mode}
              onScroll={(event) => {
                scrollOffset.current = event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={16}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={{
                maxHeight: activityDrawerScrollableContentMaxHeight(
                  viewport.height,
                  insets.top,
                  insets.bottom,
                ),
              }}
            >
              {content}
            </ScrollView>
          ) : (
            content
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(35, 31, 28, 0.38)' },
  sheet: {
    flexShrink: 1,
    maxHeight: '100%',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 2,
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
  scrollContent: { gap: 12 },
});
