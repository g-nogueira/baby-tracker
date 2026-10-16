import { TodayScreen } from '@/features/naps/today-screen';
import { useRouter } from 'expo-router';

export default function LocalTrackerScreen() {
  const router = useRouter();
  return <TodayScreen onReturnToSharedTracker={() => router.replace('/')} />;
}
