import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { Text } from '@/features/shared/tracking-text';

export interface SaveRecovery {
  checking: boolean;
  onReviewCloud: () => void;
}

export function SaveRecoveryNotice({
  checking,
  onReviewCloud,
  onLayout,
}: SaveRecovery & { onLayout?: (event: LayoutChangeEvent) => void }) {
  const theme = useActivityTheme();
  return (
    <View
      onLayout={onLayout}
      style={{
        width: '100%',
        padding: 16,
        gap: 8,
        borderRadius: 16,
        backgroundColor: theme.raised,
      }}
    >
      <Text accessibilityLiveRegion="polite" style={{ color: theme.muted }}>
        {checking
          ? 'Checking cloud records…'
          : 'The last change needs a cloud check. The app will check again automatically.'}
      </Text>
      {!checking ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review cloud records"
          onPress={onReviewCloud}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: theme.accent }}>Review cloud records</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
