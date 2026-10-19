import { useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { Text } from '@/features/shared/tracking-text';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { useActivityTheme } from '@/features/shared/activity-theme';
import type { ProjectedRadialActivity, RadialCycleView } from './radial-cycle-state';
import {
  DIAL_MARKER_RADIUS,
  historyActivityColor,
  historyDialGroups,
  historyTargetIcon,
  type HistoryDialTarget,
} from './history-dial-state';

/** Connected dial groups share the track with their boundary; opening a group never guesses its editor. */
export function HistoryDialMarkers({
  view,
  size,
  disabled,
  onPressRecord,
  onPressAnchor,
  napPosition = 'middle',
}: {
  view: RadialCycleView;
  size: number;
  napPosition?: 'start' | 'middle';
  disabled: boolean;
  onPressRecord: (record: ProjectedRadialActivity) => void;
  onPressAnchor?: (id: string) => void;
}) {
  const theme = useActivityTheme();
  const sheet = useRef<TrueSheet>(null);
  const [group, setGroup] = useState<HistoryDialTarget[] | null>(null);
  const pending = useRef<HistoryDialTarget | null>(null);
  const clock = (at: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: view.projection?.cycle.timezone,
    }).format(new Date(at));
  const label = (target: HistoryDialTarget) =>
    target.record
      ? `${target.record.kind === 'night-waking' ? 'Night waking' : target.record.kind[0].toUpperCase() + target.record.kind.slice(1)} at ${clock(target.record.occurredAt)}`
      : `${target.anchor.kind === 'bedtime' ? 'Bedtime' : 'Wake up'} at ${clock(target.anchor.at)}`;
  const open = (target: HistoryDialTarget) => {
    if (target.record) onPressRecord(target.record);
    else if (target.anchor.recordId) onPressAnchor?.(target.anchor.recordId);
  };
  return (
    <>
      {historyDialGroups(view, size, napPosition).map((targets) => {
        const first = targets[0];
        const boundary = targets.find((target) => target.anchor);
        const radians = ((first.angle - 90) * Math.PI) / 180;
        const color = historyActivityColor(historyTargetIcon(first));
        const grouped = targets.length > 1;
        const bareNap = napPosition === 'middle' && !grouped && first.record?.kind === 'nap';
        return (
          <Pressable
            key={first.id}
            accessibilityRole="button"
            accessibilityLabel={
              grouped ? `${targets.length} nearby activities. Choose a record` : label(first)
            }
            disabled={disabled}
            accessibilityState={{ disabled }}
            accessibilityHint={
              grouped
                ? 'Opens every activity and boundary in this group'
                : 'Opens this exact record for editing'
            }
            onPress={() => (grouped ? setGroup(targets) : open(first))}
            style={{
              position: 'absolute',
              left: ((160 + Math.cos(radians) * DIAL_MARKER_RADIUS) * size) / 320 - 22,
              top: ((160 + Math.sin(radians) * DIAL_MARKER_RADIUS) * size) / 320 - 22,
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
            }}
          >
            {grouped ? (
              <>
                <View
                  style={{
                    position: 'absolute',
                    left: -1,
                    top: 0,
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    borderWidth: 2,
                    borderColor: color,
                    backgroundColor: theme.track,
                  }}
                />
                <View
                  style={{
                    position: 'absolute',
                    left: 7,
                    top: 6,
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    borderWidth: 2,
                    borderColor: historyActivityColor(historyTargetIcon(targets.at(-1) ?? first)),
                    backgroundColor: '#263B40',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ActivityIcon name="more" color={theme.text} size={25} />
                </View>
              </>
            ) : (
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  borderWidth: bareNap ? 0 : 2,
                  borderColor: color,
                  backgroundColor: bareNap ? 'transparent' : `${color}16`,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: color,
                  shadowOpacity: 0.18,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 0 },
                }}
              >
                <ActivityIcon
                  name={historyTargetIcon(first)}
                  color={color}
                  size={bareNap ? 21 : 27}
                />
              </View>
            )}
            {boundary?.anchor ? (
              <Text
                numberOfLines={1}
                style={{
                  position: 'absolute',
                  top: 50,
                  left: -38,
                  width: 120,
                  color: '#EFB77B',
                  fontSize: 14,
                  textAlign: 'center',
                }}
              >
                {clock(boundary.anchor.at)}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
      {group ? (
        <TrueSheet
          ref={sheet}
          initialDetentIndex={0}
          detents={['auto', 0.8]}
          scrollable
          draggable
          dismissible
          backgroundColor={theme.surface}
          accessibilityOptions={{ paneTitle: 'Nearby activities' }}
          onDidDismiss={() => {
            setGroup(null);
            const target = pending.current;
            pending.current = null;
            if (target) open(target);
          }}
        >
          <ScrollView nestedScrollEnabled contentContainerStyle={{ padding: 24 }}>
            <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 18 }}>
              Nearby activities
            </Text>
            {group.map((target) => (
              <Pressable
                key={target.id}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${label(target)}`}
                disabled={disabled}
                onPress={() => {
                  if (pending.current) return;
                  pending.current = target;
                  void sheet.current?.dismiss().catch(() => {
                    pending.current = null;
                  });
                }}
                style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <ActivityIcon
                  name={historyTargetIcon(target)}
                  color={historyActivityColor(historyTargetIcon(target))}
                />
                <Text style={{ color: theme.text, fontSize: 14 }}>{label(target)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </TrueSheet>
      ) : null}
    </>
  );
}
