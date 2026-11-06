import { useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { Text } from '@/features/shared/tracking-text';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { activityIcons, activityLabels, nightActivityColors } from './activity-sheet';
import type { CareActivity } from './contracts';
import type { CareIssueGroup } from './care-issue-state';

/** Review exact dated records; dismiss the native sheet before opening their editor. */
export function CareIssuesSheet({
  groups,
  timezone,
  disabled,
  busy,
  refreshing,
  onRefresh,
  onDismiss,
  onSelect,
}: {
  groups: readonly CareIssueGroup[];
  timezone: string;
  disabled: boolean;
  busy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onDismiss: () => void;
  onSelect: (activity: CareActivity) => void;
}) {
  const theme = useActivityTheme();
  const insets = useSafeAreaInsets();
  const sheet = useRef<TrueSheet>(null);
  const pending = useRef<CareActivity | null>(null);
  const format = (at: string) =>
    new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
    }).format(new Date(at));
  return (
    <TrueSheet
      ref={sheet}
      initialDetentIndex={0}
      detents={[0.7, 0.94]}
      scrollable
      draggable
      dismissible
      cornerRadius={28}
      backgroundColor={theme.surface}
      grabberOptions={{ color: theme.muted, width: 42, adaptive: false }}
      accessibilityOptions={{ paneTitle: 'Review recorded times' }}
      onDidDismiss={() => {
        const record = pending.current;
        pending.current = null;
        onDismiss();
        if (record) onSelect(record);
      }}
    >
      <ScrollView
        nestedScrollEnabled
        contentContainerStyle={{ padding: 20, paddingBottom: 24 + insets.bottom, gap: 20 }}
      >
        <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 22 }}>
          Review recorded times
        </Text>
        <Text style={{ color: theme.muted }}>Open an activity to check its dates and times.</Text>
        {groups.length === 0 ? (
          <Text style={{ color: theme.muted }}>No recorded time issues in this cycle.</Text>
        ) : null}
        {groups.map((group) => (
          <View key={group.id} style={{ gap: 10 }}>
            <Text style={{ color: theme.muted }}>{group.message}</Text>
            {group.activities.map((activity) => {
              const title = activity.kind === 'bedtime' ? 'Bedtime' : activityLabels[activity.kind];
              return (
                <Pressable
                  key={activity.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Review ${title} at ${format(activity.startedAt)}`}
                  disabled={disabled}
                  onPress={() => {
                    if (pending.current) return;
                    pending.current = activity;
                    void sheet.current?.dismiss().catch(() => {
                      pending.current = null;
                    });
                  }}
                  style={{
                    padding: 14,
                    borderRadius: 16,
                    backgroundColor: theme.field,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 64,
                  }}
                >
                  <ActivityIcon
                    name={activityIcons[activity.kind]}
                    color={nightActivityColors[activity.kind]}
                    size={30}
                  />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: theme.text }}>{title}</Text>
                    <Text style={{ color: theme.muted, fontSize: 13 }}>
                      {format(activity.startedAt)}
                      {activity.endedAt && activity.endedAt !== activity.startedAt
                        ? ` – ${format(activity.endedAt)}`
                        : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {group.activities.length === 0 ? (
              <Text style={{ color: theme.muted }}>Refresh to load this activity's details.</Text>
            ) : null}
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh reviewed activities"
          disabled={refreshing || busy}
          onPress={onRefresh}
          style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: theme.accent }}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
        </Pressable>
      </ScrollView>
    </TrueSheet>
  );
}
