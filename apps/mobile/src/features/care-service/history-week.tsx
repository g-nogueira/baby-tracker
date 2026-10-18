import { Pressable, View } from 'react-native';
import { Text } from '@/features/shared/tracking-text';
import { shiftCalendarDay } from '@/features/naps/calendar-day';
import { useActivityTheme } from '@/features/shared/activity-theme';

/** Calendar navigation uses calendar arithmetic, independently of UTC day length and DST. */
export function HistoryWeek({
  date,
  today,
  onChange,
  disabled,
}: {
  date: string;
  today: string;
  onChange: (date: string) => void;
  disabled: boolean;
}) {
  const theme = useActivityTheme();
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const first = shiftCalendarDay(date, -day);
  const title = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  return (
    <View style={{ gap: 16, paddingBottom: 12, width: '100%' }}>
      <View
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          height: 44,
          width: '100%',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          disabled={disabled}
          onPress={() => onChange(shiftCalendarDay(date, -1))}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 22, color: theme.muted }}>‹</Text>
        </Pressable>
        <Text
          numberOfLines={1}
          style={{ fontSize: 18, color: theme.text, width: '60%', textAlign: 'center' }}
        >
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next day"
          disabled={disabled || date >= today}
          onPress={() => onChange(shiftCalendarDay(date, 1))}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 22, color: theme.muted, opacity: date >= today ? 0.3 : 1 }}>
            ›
          </Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {Array.from({ length: 7 }, (_, i) => {
          const at = shiftCalendarDay(first, i);
          const selected = at === date;
          const future = at > today;
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
                minHeight: 60,
                alignItems: 'center',
                gap: 10,
                opacity: future ? 0.35 : 1,
              }}
            >
              <Text style={{ color: theme.muted, fontSize: 11 }}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'][i]}
              </Text>
              <View
                style={{
                  height: 30,
                  width: 30,
                  borderRadius: 15,
                  backgroundColor: selected ? theme.raised : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: selected ? theme.accent : theme.muted, fontSize: 12 }}>
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
