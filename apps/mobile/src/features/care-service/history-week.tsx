import { type ReactNode, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from '@/features/shared/tracking-text';
import {
  calendarDayForInstant,
  instantForZonedDateTime,
  shiftCalendarDay,
} from '@/features/naps/calendar-day';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { StableDateTimePicker } from '@/features/shared/activity-drawer/stable-date-time-picker';

/** A compact history header; the date opens real calendar navigation rather than another title row. */
export function HistoryWeek({
  date,
  today,
  timezone,
  profileName,
  profileButton,
  onChange,
  disabled,
}: {
  date: string;
  today: string;
  timezone: string;
  profileName: string;
  profileButton: ReactNode;
  onChange: (date: string) => void;
  disabled: boolean;
}) {
  const theme = useActivityTheme();
  const [calendar, setCalendar] = useState(false);
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const first = shiftCalendarDay(date, -day);
  const title = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  const [year, month, calendarDate] = date.split('-').map(Number);
  const selected = instantForZonedDateTime(
    { year, month, day: calendarDate, hour: 12, minute: 0, second: 0 },
    timezone,
  );
  return (
    <View style={{ width: '100%' }}>
      <View style={{ height: 44, flexDirection: 'row', alignItems: 'center' }}>
        {profileButton}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose history date"
          accessibilityState={{ expanded: calendar }}
          disabled={disabled}
          onPress={() => setCalendar((open) => !open)}
          style={{
            position: 'absolute',
            left: 52,
            right: 52,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text
              numberOfLines={1}
              style={{ flexShrink: 0, color: theme.text, fontSize: 16, fontWeight: '500' }}
            >
              {title}
            </Text>
            <ActivityIcon name="down" size={16} color={theme.text} />
          </View>
          <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 13 }}>
            {profileName}
          </Text>
        </Pressable>
      </View>
      {calendar ? (
        <View style={{ paddingVertical: 8, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {(['Previous day', 'Next day'] as const).map((label, index) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={label}
                disabled={disabled || (index === 1 && date >= today)}
                onPress={() => onChange(shiftCalendarDay(date, index ? 1 : -1))}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: index && date >= today ? 0.3 : 1,
                }}
              >
                <Text style={{ color: theme.muted }}>{index ? '›' : '‹'}</Text>
              </Pressable>
            ))}
          </View>
          <StableDateTimePicker
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            value={new Date(Math.min(Date.now(), selected.getTime()))}
            maximumDate={new Date()}
            timeZoneName={timezone}
            onChange={(event, at) => {
              if (Platform.OS === 'android') setCalendar(false);
              if (event.type === 'dismissed' || !at) return;
              const next = calendarDayForInstant(at, timezone);
              if (next <= today) onChange(next);
            }}
          />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 }}>
        {Array.from({ length: 7 }, (_, i) => {
          const at = shiftCalendarDay(first, i),
            selected = at === date,
            future = at > today;
          return (
            <Pressable
              key={at}
              accessibilityRole="button"
              accessibilityLabel={`Show ${at}`}
              accessibilityState={{ selected, disabled: disabled || future }}
              disabled={disabled || future}
              onPress={() => onChange(at)}
              style={{
                flex: 1,
                minHeight: 62,
                alignItems: 'center',
                gap: 12,
                opacity: future ? 0.35 : 1,
              }}
            >
              <Text style={{ color: theme.muted, fontSize: 13 }}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'][i]}
              </Text>
              <View
                style={{
                  height: 34,
                  width: 34,
                  borderRadius: 17,
                  backgroundColor: selected ? '#25243E' : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: selected ? theme.accent : theme.muted, fontSize: 14 }}>
                  {Number(at.slice(-2))}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
