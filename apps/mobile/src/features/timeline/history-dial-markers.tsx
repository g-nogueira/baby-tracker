import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { NearbyActivitiesSheet } from './nearby-activities-sheet';
import { Text } from '@/features/shared/tracking-text';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { useActivityTheme } from '@/features/shared/activity-theme';
import type { ProjectedRadialActivity, RadialCycleView } from './radial-cycle-state';
import {
  DIAL_MARKER_RADIUS,
  historyActivityColor,
  historyDialGroups,
  historyDialGroupBadge,
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
  onPressGroup,
}: {
  view: RadialCycleView;
  size: number;
  onPressGroup?: (targets: HistoryDialTarget[]) => void;
  napPosition?: 'start' | 'middle';
  disabled: boolean;
  onPressRecord: (record: ProjectedRadialActivity) => void;
  onPressAnchor?: (id: string) => void;
}) {
  const theme = useActivityTheme();
  const [group, setGroup] = useState<HistoryDialTarget[] | null>(null);
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
        const { front: first, back, angle } = historyDialGroupBadge(targets);
        const boundary = targets.find((target) => target.anchor);
        const radians = ((angle - 90) * Math.PI) / 180;
        const color = historyActivityColor(historyTargetIcon(first));
        const grouped = targets.length > 1;
        // Keep neighboring centers tappable when their badge edges overlap.
        const targetSize = grouped ? 44 : 36;
        const activeNursing = first.record?.kind === 'nursing' && first.record.status === 'active';
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
            onPress={() => (grouped ? (onPressGroup ?? setGroup)(targets) : open(first))}
            style={{
              position: 'absolute',
              left: ((160 + Math.cos(radians) * DIAL_MARKER_RADIUS) * size) / 320 - targetSize / 2,
              top: ((160 + Math.sin(radians) * DIAL_MARKER_RADIUS) * size) / 320 - targetSize / 2,
              width: targetSize,
              height: targetSize,
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
                    left: 0,
                    top: 9,
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    borderWidth: 2,
                    borderColor: historyActivityColor(historyTargetIcon(back ?? first)),
                    backgroundColor: theme.field,
                  }}
                />
                <View
                  style={{
                    position: 'absolute',
                    left: 4,
                    top: 4,
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    borderWidth: 2,
                    borderColor: color,
                    backgroundColor: theme.field,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ActivityIcon name="more-filled" color={theme.muted} size={24} />
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
                  borderStyle: activeNursing ? 'dotted' : 'solid',
                  backgroundColor: bareNap ? 'transparent' : `${color}16`,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: color,
                  shadowOpacity: activeNursing ? 0.5 : 0.18,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 0 },
                }}
              >
                <ActivityIcon
                  name={historyTargetIcon(first)}
                  color={color}
                  size={
                    bareNap
                      ? 21
                      : first.record?.kind === 'diaper' || first.record?.kind === 'nursing'
                        ? 22
                        : 27
                  }
                />
              </View>
            )}
            {boundary?.anchor ? (
              <Text
                numberOfLines={1}
                style={{
                  position: 'absolute',
                  top: targetSize / 2 + 28,
                  left: targetSize / 2 - 60,
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
        <NearbyActivitiesSheet
          targets={group}
          view={view}
          disabled={disabled}
          onDismiss={() => setGroup(null)}
          onSelect={open}
        />
      ) : null}
    </>
  );
}
