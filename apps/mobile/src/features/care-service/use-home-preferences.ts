import { useEffect, useRef, useState } from 'react';
import { defaultHomePreferences, type HomePreferences } from './home-preferences';
import { homePreferencesStore } from './home-preferences-store';
export function useHomePreferences() {
  const [value, setValue] = useState(defaultHomePreferences);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(Promise.resolve());
  useEffect(() => {
    let mounted = true;
    void homePreferencesStore
      .load()
      .then((p) => {
        if (mounted) setValue(p);
      })
      .catch(() => {
        if (mounted) setError('Home preferences could not be loaded. Defaults are shown.');
      })
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);
  const change = (next: HomePreferences) => {
    if (!ready) return;
    setValue(next);
    pending.current = pending.current
      .then(() => homePreferencesStore.save(next))
      .then(() => setError(null))
      .catch(() => setError('Home preferences could not be saved. Try changing them again.'));
  };
  return { value, ready, error, change };
}
