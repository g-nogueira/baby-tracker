import { Pressable, TextInput, View } from 'react-native';
import { Text } from '@/features/shared/tracking-text';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { useActivityTheme } from '@/features/shared/activity-theme';
import type { ActivityDetails, SleepMethod, WakeMood } from './contracts';

const methods: [SleepMethod, string, string][] = [
  ['in-bed', 'In bed', 'cradle'],
  ['nursing', 'Nursing', 'nursing-baby'],
  ['held', 'Worn or held', 'held-baby'],
  ['next-to-me', 'Next to me', 'next-to-baby'],
  ['bottle', 'Bottle feeding', 'bottle'],
  ['stroller', 'Stroller', 'stroller'],
  ['car', 'Car', 'car'],
  ['swing', 'Swing', 'swing'],
];
/** Activity-specific annotations backed by the same provider-neutral save as the timestamp. */
export function SleepDetailsFields({
  kind,
  details,
  onChange,
  disabled,
}: {
  kind: 'bedtime' | 'nap' | 'night-waking' | 'wake-up';
  details: ActivityDetails;
  onChange: (patch: ActivityDetails) => void;
  disabled: boolean;
}) {
  const theme = useActivityTheme();
  const option = (
    key: string,
    label: string,
    icon: string,
    selected: boolean,
    onPress: () => void,
    width = '31%',
  ) => (
    <Pressable
      key={key}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: width as `${number}%`,
        minHeight: 92,
        borderRadius: 12,
        backgroundColor: selected ? theme.accentSoft : theme.field,
        borderWidth: 1,
        borderColor: selected ? theme.accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8,
        gap: 8,
      }}
    >
      <ActivityIcon name={icon} size={40} />
      <Text style={{ fontSize: 13, color: theme.muted, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 28 }}>
      {kind === 'bedtime' || kind === 'nap' ? (
        <>
          <View style={{ gap: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: '500', color: theme.text }}>Start</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(
                [
                  ['took-long', 'Long time to fall asleep', 'clock'],
                  ['upset', 'Upset', 'sad-baby'],
                ] as const
              ).map(([key, label, icon]) =>
                option(
                  key,
                  label,
                  icon,
                  details.settling?.includes(key) ?? false,
                  () =>
                    onChange({
                      settling: details.settling?.includes(key)
                        ? details.settling.filter((v) => v !== key)
                        : [...(details.settling ?? []), key],
                    }),
                  '48.5%',
                ),
              )}
            </View>
          </View>
          <View style={{ gap: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: '500', color: theme.text }}>How</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {methods.map(([key, label, icon]) =>
                option(key, label, icon, details.sleepMethod === key, () =>
                  onChange({ sleepMethod: details.sleepMethod === key ? null : key }),
                ),
              )}
            </View>
          </View>
        </>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '500', color: theme.text }}>Wake up mood</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(
              [
                ['bad', 'Bad mood', 'sad-baby'],
                ['neutral', 'Neutral', 'neutral-baby'],
                ['good', 'Good mood', 'happy-baby'],
              ] as [WakeMood, string, string][]
            ).map(([key, label, icon]) =>
              option(key, label, icon, details.wakeMood === key, () =>
                onChange({ wakeMood: details.wakeMood === key ? null : key }),
              ),
            )}
          </View>
        </View>
      )}
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '500', color: theme.text }}>Comment</Text>
        <TextInput
          accessibilityLabel="Activity comment"
          placeholder="No comment added yet"
          placeholderTextColor={theme.muted}
          multiline
          value={details.comment ?? ''}
          editable={!disabled}
          onChangeText={(comment) => onChange({ comment })}
          style={{
            minHeight: 80,
            padding: 12,
            borderRadius: 12,
            backgroundColor: theme.field,
            color: theme.text,
            fontSize: 16,
            fontFamily: theme.night ? 'Saans-Regular' : undefined,
            textAlignVertical: 'top',
          }}
        />
      </View>
    </View>
  );
}
