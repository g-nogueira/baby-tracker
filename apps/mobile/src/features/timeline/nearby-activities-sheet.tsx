import { useRef } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { Text } from '@/features/shared/tracking-text';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { clockLabel } from '@/features/care-service/presentation';
import type { RadialCycleView } from './radial-cycle-state';
import {
  historyActivityColor,
  historyTargetDetails,
  historyTargetIcon,
  type HistoryDialTarget,
} from './history-dial-state';

/** Compact cards for a dial cluster; open its exact record only after native dismissal. */
export function NearbyActivitiesSheet({
  targets,
  view,
  disabled,
  onSelect,
  onDismiss,
}: {
  targets: readonly HistoryDialTarget[];
  view: RadialCycleView;
  disabled: boolean;
  onSelect: (target: HistoryDialTarget) => void;
  onDismiss: () => void;
}) {
  const theme = useActivityTheme();
  const sheet = useRef<TrueSheet>(null);
  const pending = useRef<HistoryDialTarget | null>(null);
  const { height, fontScale = 1 } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const rowHeight = 96 * Math.max(1, fontScale);
  const detent = Math.min(
    0.8,
    (80 + targets.length * rowHeight + Math.max(0, targets.length - 1) * 10 + insets.bottom) /
      height,
  );
  const clock = (at: string) =>
    clockLabel(new Date(at), view.projection?.cycle.timezone ?? 'UTC', false);
  return (
    <TrueSheet
      ref={sheet}
      initialDetentIndex={0}
      detents={[detent]}
      scrollable
      draggable
      dismissible
      cornerRadius={28}
      backgroundColor={theme.surface}
      grabberOptions={{ color: theme.muted, width: 42, adaptive: false }}
      accessibilityOptions={{ paneTitle: 'Nearby activities' }}
      onDidDismiss={() => {
        const target = pending.current;
        pending.current = null;
        onDismiss();
        if (target) onSelect(target);
      }}
    >
      <ScrollView
        nestedScrollEnabled
        contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom, gap: 10 }}
      >
        {[...targets].reverse().map((target) => {
          const details = historyTargetDetails(target, view);
          const color = historyActivityColor(historyTargetIcon(target));
          const label =
            target.record?.kind === 'nap'
              ? 'Nap'
              : details.title === 'Wake-up'
                ? 'Wake up'
                : details.title;
          return (
            <Pressable
              key={target.id}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${label} at ${clockLabel(new Date(details.start), view.projection?.cycle.timezone ?? 'UTC')}`}
              disabled={disabled || pending.current !== null}
              onPress={() => {
                if (pending.current) return;
                pending.current = target;
                void sheet.current?.dismiss().catch(() => {
                  pending.current = null;
                });
              }}
              style={{
                width: '100%',
                minHeight: rowHeight,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                padding: 16,
                borderRadius: 18,
                backgroundColor: theme.field,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  borderRadius: 20,
                  borderWidth: 1.5,
                  borderColor: color,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ActivityIcon name={historyTargetIcon(target)} color={color} size={26} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '500' }}>
                  {details.title}
                </Text>
                {details.subtitle ? (
                  <Text style={{ color: theme.muted, fontSize: 13 }}>{details.subtitle}</Text>
                ) : null}
              </View>
              <Text style={{ color: theme.text, fontSize: 18, textAlign: 'right', flexShrink: 1 }}>
                {clock(details.start)}
                {details.end
                  ? ` – ${clock(details.end)}`
                  : details.running
                    ? ' · Running'
                    : details.paused
                      ? ' · Paused'
                      : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </TrueSheet>
  );
}
