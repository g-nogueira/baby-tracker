import { createCareProvider } from '@/composition/care-provider';
import { CareScreen } from '@/features/care-service/care-screen';

export default function Index() {
  return <CareScreen createProvider={createCareProvider} />;
}
