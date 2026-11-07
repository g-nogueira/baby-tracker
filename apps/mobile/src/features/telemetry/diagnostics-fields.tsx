import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { Text } from '@/features/shared/tracking-text';
import {
  defaultDiagnosticsSettings,
  type DiagnosticsPreferences,
  normalizeCollectorUrl,
} from './diagnostics-settings';

export function DiagnosticsFields({ preferences }: { preferences: DiagnosticsPreferences }) {
  const theme = useActivityTheme();
  const [draft, setDraft] = useState(defaultDiagnosticsSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void preferences
      .load()
      .then((settings) => {
        if (active) setDraft(settings);
      })
      .catch(() => {
        if (active) setError('Could not load diagnostics settings. You can enter them again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [preferences]);

  const save = async () => {
    setNotice('');
    const endpoint = normalizeCollectorUrl(draft.endpoint);
    if (endpoint === null) {
      setError(
        'Enter an HTTPS Collector URL without credentials or a /v1/logs or /v1/traces suffix.',
      );
      return;
    }
    setSaving(true);
    setError('');
    try {
      const next = { ...draft, endpoint };
      await preferences.save(next);
      setDraft(next);
      setNotice(endpoint ? 'Diagnostics settings saved.' : 'Diagnostics turned off.');
    } catch {
      setError('Could not save diagnostics settings. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || saving;
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 18 }}>
        Diagnostics
      </Text>
      <Text style={{ color: theme.muted }}>Collector URL</Text>
      <TextInput
        accessibilityLabel="Collector URL"
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="url"
        editable={!busy}
        placeholder="https://collector.example.net:4320"
        placeholderTextColor={theme.muted}
        style={[styles.field, { color: theme.text, backgroundColor: theme.field }]}
        value={draft.endpoint}
        onChangeText={(endpoint) => {
          setDraft({ ...draft, endpoint });
          setError('');
          setNotice('');
        }}
      />
      <Text style={{ color: theme.muted, fontSize: 13 }}>
        Enter your LAN Collector URL. Leave it blank to turn off diagnostics.
      </Text>
      <View style={styles.row}>
        <Text style={{ color: theme.muted }}>Verbose sync logs</Text>
        <Switch
          accessibilityLabel="Verbose sync logs"
          disabled={busy}
          value={draft.verbose}
          onValueChange={(verbose) => {
            setDraft({ ...draft, verbose });
            setNotice('');
          }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void save()}
        style={[styles.button, { backgroundColor: theme.field }]}
      >
        <Text style={{ color: theme.accent }}>
          {saving ? 'Saving…' : 'Save diagnostics settings'}
        </Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.error }}>
          {error}
        </Text>
      ) : notice ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.muted }}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  field: { minHeight: 48, borderRadius: 12, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
});
