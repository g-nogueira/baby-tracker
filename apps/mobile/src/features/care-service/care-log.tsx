import { Pressable, View, useWindowDimensions } from 'react-native';
import { Text } from '@/features/shared/tracking-text';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { useActivityTheme } from '@/features/shared/activity-theme';
import type { CareActivity, CareKind } from './contracts';
import { careLogEntries, careLogWindow } from './care-log-state';
import { clockLabel } from './presentation';

const appearance: Record<CareKind, { icon: string; accent: string; background: string }> = {
  'wake-up': { icon: 'wake', accent: '#F1C764', background: '#2D283A' },
  bedtime: { icon: 'bedtime', accent: '#E9A26E', background: '#2C2538' },
  nap: { icon: 'nap', accent: '#A19CFF', background: '#25233F' },
  'night-waking': { icon: 'night-waking', accent: '#F09C8C', background: '#30253B' },
  nursing: { icon: 'nursing', accent: '#A0EBCF', background: '#222B3C' },
  diaper: { icon: 'diaper', accent: '#F1A0DB', background: '#2E2541' },
  medicine: { icon: 'medicine', accent: '#E0E78F', background: '#2B2B3B' },
};

/** A chronological log of real records; phase summaries are derived, non-editable separators. */
export function CareLog({
  activities,
  context,
  now,
  timezone,
  disabled,
  onOpen,
}: {
  activities: readonly CareActivity[];
  context: readonly CareActivity[];
  now: Date;
  timezone: string;
  disabled: boolean;
  onOpen: (activity: CareActivity) => void;
}) {
  const theme = useActivityTheme();
  const { width } = useWindowDimensions();
  const fontSize = width < 360 ? 14 : 17;
  const clock = (at: string) => clockLabel(new Date(at), timezone).replace(/\u202f/g, ' ');
  return (
    <View style={{ width: '100%', gap: 6 }}>
      {careLogEntries(activities, context, now).map(({ activity, title, details, summary }) => {
        const colors = appearance[activity.kind];
        const range =
          activity.kind === 'nap' ||
          activity.kind === 'night-waking' ||
          activity.kind === 'nursing' ||
          (activity.kind === 'bedtime' &&
            activity.endedAt !== null &&
            activity.endedAt !== activity.startedAt);
        return (
          <View key={activity.id} style={{ width: '100%', flexShrink: 0 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title} at ${clock(activity.startedAt)}`}
              disabled={disabled}
              onPress={() => onOpen(activity)}
              style={{
                minHeight: Math.max(64, 43 + details.length * 23),
                flexShrink: 0,
                width: '100%',
                paddingHorizontal: 14,
                paddingVertical: 10,
                paddingLeft: 18,
                borderRadius: 8,
                backgroundColor: colors.background,
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 10,
                overflow: 'hidden',
              }}
            >
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 6,
                  borderRadius: 3,
                  backgroundColor: colors.accent,
                }}
              />
              <View style={{ marginTop: 1, width: 28, height: 28, flexShrink: 0 }}>
                <ActivityIcon name={colors.icon} size={28} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <Text
                    style={{
                      color: theme.text,
                      fontSize,
                      lineHeight: 23,
                      fontWeight: '500',
                      flexShrink: 1,
                    }}
                  >
                    {title}
                  </Text>
                  <Text
                    style={{
                      color: theme.text,
                      fontSize,
                      lineHeight: 23,
                      textAlign: 'right',
                      flexShrink: 1,
                    }}
                  >
                    {clock(activity.startedAt)}
                    {range ? ` – ${activity.endedAt ? clock(activity.endedAt) : '…'}` : ''}
                  </Text>
                </View>
                {details.map((detail) => (
                  <Text key={detail} style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>
                    {detail}
                  </Text>
                ))}
              </View>
            </Pressable>
            {summary ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 18,
                  paddingLeft: 58,
                  paddingRight: 8,
                }}
              >
                <ActivityIcon name={summary.kind === 'wake-window' ? 'nap' : 'moon'} size={22} />
                <Text style={{ color: theme.muted, fontSize: 14, flexShrink: 1 }}>
                  End of {careLogWindow(summary.durationMs)}{' '}
                  {summary.kind === 'wake-window' ? 'wake window' : 'sleep session'}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
