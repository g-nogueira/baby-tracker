import { Pressable, View } from 'react-native';
import { Text } from '@/features/shared/tracking-text';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { homeActionIds } from './home-preferences';
import type { useHomePreferences } from './use-home-preferences';
const labels = {
  night: 'Bedtime / Wake up',
  sleep: 'Nap / Night waking',
  nursing: 'Nursing',
  diaper: 'Diaper',
  medicine: 'Medicine',
};
export function HomePreferencesFields({
  preferences,
}: {
  preferences: ReturnType<typeof useHomePreferences>;
}) {
  const theme = useActivityTheme();
  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 18 }}>
        Home actions
      </Text>
      {homeActionIds.map((id) => (
        <Pressable
          key={id}
          accessibilityRole="checkbox"
          accessibilityLabel={`Show ${labels[id]} action`}
          accessibilityState={{
            checked: preferences.value.actions.includes(id),
            disabled: !preferences.ready,
          }}
          disabled={!preferences.ready}
          onPress={() =>
            preferences.change({
              ...preferences.value,
              actions: preferences.value.actions.includes(id)
                ? preferences.value.actions.filter((a) => a !== id)
                : [...preferences.value.actions, id],
            })
          }
          style={{
            minHeight: 44,
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: theme.field,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ color: theme.muted }}>{labels[id]}</Text>
          <Text style={{ color: theme.accent }}>
            {preferences.value.actions.includes(id) ? '✓' : ''}
          </Text>
        </Pressable>
      ))}
      <Text style={{ color: theme.muted }}>
        Bedtime visible from {String(preferences.value.bedtimeFromHour).padStart(2, '0')}:00
      </Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {[-1, 1].map((delta) => (
          <Pressable
            key={delta}
            accessibilityRole="button"
            accessibilityLabel={
              delta < 0 ? 'Show Bedtime one hour earlier' : 'Show Bedtime one hour later'
            }
            disabled={
              !preferences.ready ||
              preferences.value.bedtimeFromHour + delta < 0 ||
              preferences.value.bedtimeFromHour + delta > 23
            }
            onPress={() =>
              preferences.change({
                ...preferences.value,
                bedtimeFromHour: preferences.value.bedtimeFromHour + delta,
              })
            }
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 16,
              backgroundColor: theme.field,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.muted }}>{delta < 0 ? '−1 hour' : '+1 hour'}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ color: theme.muted, fontSize: 12 }}>
        Running sleep controls remain available.
      </Text>
      {preferences.error ? (
        <Text accessibilityRole="alert" style={{ color: theme.error }}>
          {preferences.error}
        </Text>
      ) : null}
    </View>
  );
}
