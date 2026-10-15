import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatLiveDuration } from '@/features/naps/nap-clock';
import { shiftCalendarDay } from '@/features/naps/calendar-day';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { ActivityLiveController } from '@/features/shared/live-controller/activity-live-controller';
import { RadialCycle } from '@/features/timeline/radial-cycle';
import type { Breast, WireLog } from './contracts';
import { nursingTotals, readNursing } from './nursing';
import { NapperNursingSheet } from './nursing-sheet';
import { dateFeeds, inspectNursingLogs, nursingCycle } from './nursing-view';
import { useNapper } from './use-napper';

type Drawer = { kind: 'create' } | { kind: 'active'; id: string } | { kind: 'edit'; log: WireLog };
/** First production slice of the Napper client: account, shared Nursing state and correction. */
export function NapperScreen() {
  const model = useNapper();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const now = new Date(Math.max(clock.getTime(), Date.now()));
  const open = model.current.filter((log) => log.category === 'NURSING' && log.isOpen === true);
  const active = open.length === 1 ? open[0] : null;
  const currentNursing = inspectNursingLogs(model.current, now);
  const historyNursing = inspectNursingLogs(model.history, now);
  const activeFeed = currentNursing.valid.find((feed) => feed.id === active?.id);
  const invalid = active !== null && activeFeed === undefined;
  const unknownRunningState = model.current.some(
    (log) => log.category === 'NURSING' && typeof log.isOpen !== 'boolean',
  );
  const latest = [...currentNursing.valid]
    .filter((feed) => !feed.open)
    .sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0];
  const last: Breast | null = latest?.last ?? null;
  const total = activeFeed ? nursingTotals(activeFeed, now) : null;
  const unsupported =
    currentNursing.unsupportedIds.length + historyNursing.unsupportedIds.length > 0;
  useEffect(() => {
    if (drawer?.kind === 'create' && active) setDrawer({ kind: 'active', id: String(active.id) });
    else if (drawer?.kind === 'active' && !open.some((log) => log.id === drawer.id))
      setDrawer(null);
  }, [active, drawer, open]);
  const close = (candidate: Drawer) =>
    setDrawer((current) => (current === candidate ? null : current));
  const openRecord = (log: WireLog) => {
    model.clearError();
    setDrawer(log.isOpen === true ? { kind: 'active', id: String(log.id) } : { kind: 'edit', log });
  };
  let view: ReturnType<typeof nursingCycle> | null = null;
  let timelineUnavailable = false;
  if (model.baby)
    try {
      view = nursingCycle(
        historyNursing.valid.map((feed) => feed.wire),
        model.baby.id,
        model.date,
        model.timezone,
        now,
      );
    } catch {
      timelineUnavailable = true;
    }
  const blocked =
    model.busy || model.needsRefresh || invalid || unknownRunningState || open.length > 1;
  const feeds = dateFeeds(model.history, model.date, model.timezone);
  const visibleTotal = model.date === model.today ? total : null;
  const time = (seconds: number) => formatLiveDuration(seconds * 1000);
  const format = (at: WireLog[string]) =>
    new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: model.timezone,
    }).format(new Date(String(at)));
  if (model.stage === 'loading')
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color="#B35D7D" />
        <Text>Opening Napper…</Text>
      </SafeAreaView>
    );
  const content =
    model.stage === 'email' || model.stage === 'otp' ? (
      <View style={styles.login}>
        <ActivityIcon name="nursing" color="#B35D7D" size={40} />
        <Text accessibilityRole="header" style={styles.title}>
          Connect to Napper
        </Text>
        <Text style={styles.copy}>Use the account with access to your shared baby profile.</Text>
        {model.stage === 'email' ? (
          <>
            <TextInput
              accessibilityLabel="Napper email address"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              value={email}
              editable={!model.busy}
              onChangeText={setEmail}
              style={styles.input}
            />
            <Button
              label="Send sign-in code"
              busy={model.busy}
              disabled={!email.trim().includes('@')}
              onPress={() => void model.sendOtp(email.trim())}
            />
            <Pressable
              accessibilityRole="button"
              disabled={model.busy || !email.trim().includes('@')}
              onPress={() => model.enterExistingCode()}
              style={[styles.link, (model.busy || !email.trim().includes('@')) && styles.disabled]}
            >
              <Text>Enter a code I already have</Text>
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              accessibilityLabel="Napper sign-in code"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              value={otp}
              editable={!model.busy}
              onChangeText={setOtp}
              style={styles.input}
            />
            <Button
              label="Sign in"
              busy={model.busy}
              disabled={!otp.trim()}
              onPress={() => {
                void model.login(email.trim(), otp.trim()).then((success) => {
                  if (success) setOtp('');
                });
              }}
            />
            <Pressable
              accessibilityRole="button"
              disabled={model.busy}
              onPress={() => {
                setOtp('');
                void model.signOut();
              }}
              style={styles.link}
            >
              <Text>Use another email</Text>
            </Pressable>
          </>
        )}
        <Link href="/local" style={styles.link}>
          Separate on-device tracker
        </Link>
      </View>
    ) : model.stage === 'profiles' ? (
      <View style={styles.login}>
        <Text accessibilityRole="header" style={styles.title}>
          Choose a profile
        </Text>
        {model.babies.map((baby) => (
          <Button
            key={baby.id}
            label={baby.name}
            busy={model.busy}
            onPress={() => void model.selectBaby(baby)}
          />
        ))}
        {model.babies.length === 0 ? (
          <>
            <Text>No profiles have been loaded.</Text>
            <Button
              label="Reload profiles"
              busy={model.busy}
              onPress={() => void model.loadProfiles()}
            />
          </>
        ) : null}
        <Button label="Sign out" busy={model.busy} onPress={() => void model.signOut()} />
      </View>
    ) : (
      <>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            {model.baby?.name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out of Napper"
            disabled={model.busy}
            onPress={() => {
              setDrawer(null);
              void model.signOut();
            }}
            style={styles.link}
          >
            <Text>Sign out</Text>
          </Pressable>
        </View>
        <Text style={styles.copy}>Shared Nursing records · Napper</Text>
        <Text style={styles.copy}>Sleep and other activities are coming next.</Text>
        <View style={styles.dates}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            disabled={model.busy}
            onPress={() => model.setDate(shiftCalendarDay(model.date, -1))}
            style={styles.dateButton}
          >
            <Text style={styles.arrow}>‹</Text>
          </Pressable>
          <View style={styles.dateText}>
            <Text style={styles.label}>{model.date === model.today ? 'Today' : model.date}</Text>
            <Text style={styles.copy}>Nursing</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next day"
            disabled={model.busy || model.date >= model.today}
            onPress={() => model.setDate(shiftCalendarDay(model.date, 1))}
            style={styles.dateButton}
          >
            <Text style={styles.arrow}>›</Text>
          </Pressable>
        </View>
        {view ? (
          <RadialCycle
            view={view}
            disabled={blocked}
            centerStatus={{
              label: visibleTotal
                ? visibleTotal.paused
                  ? 'Paused'
                  : 'Nursing for'
                : 'Nursing recorded',
              value: time(
                visibleTotal?.total ??
                  feeds.reduce((sum, log) => {
                    try {
                      return sum + nursingTotals(readNursing(log), now).total;
                    } catch {
                      return sum;
                    }
                  }, 0),
              ),
              hint: model.date === model.today ? 'Today' : 'Recorded on this day',
            }}
            onPressRecord={(record) => {
              const log = model.history.find((log) => log.id === record.id);
              if (log) openRecord(log);
            }}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Nursing controls"
          disabled={blocked || !model.updatedAt}
          onPress={() => {
            model.clearError();
            setDrawer(active ? { kind: 'active', id: String(active.id) } : { kind: 'create' });
          }}
          style={[styles.quickAction, (blocked || !model.updatedAt) && styles.disabled]}
        >
          <ActivityIcon name="nursing" size={28} />
        </Pressable>
        <Text style={styles.recency}>
          {activeFeed
            ? `${time(Math.max(0, Math.round((now.getTime() - Date.parse(activeFeed.start)) / 1000)))} since feed started`
            : latest
              ? `${time(Math.max(0, Math.round((now.getTime() - Date.parse(latest.end)) / 1000)))} since last feed`
              : '—'}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={model.refreshing || model.busy}
          onPress={() => void model.refresh()}
          style={styles.link}
        >
          <Text>{model.refreshing ? 'Refreshing…' : 'Refresh Napper'}</Text>
        </Pressable>
        <Text style={styles.copy}>
          {model.updatedAt
            ? `Updated ${new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(model.updatedAt)}`
            : 'Waiting for shared records'}
        </Text>
        {invalid || unknownRunningState || open.length > 1 || unsupported ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {open.length > 1
              ? 'More than one feed is running. Review the records in Napper before making another change.'
              : unknownRunningState
                ? 'A Nursing record has an unknown running state. Review it in Napper before making changes.'
                : invalid
                  ? 'This running feed could not be read. Refresh or review it in Napper before changing it.'
                  : 'Some Nursing records could not be read and are read-only here. Other feed controls remain available.'}
          </Text>
        ) : null}
        {timelineUnavailable ? (
          <Text accessibilityRole="alert" style={styles.error}>
            The timeline could not be displayed. Nursing controls remain available for valid feeds.
          </Text>
        ) : null}
        {feeds.length === 0 && !model.refreshing ? (
          <Text style={styles.empty}>No Nursing recorded on this day.</Text>
        ) : null}
        {feeds.map((log) => {
          let text = 'Review this record in Napper';
          let valid = true;
          try {
            const feed = readNursing(log);
            const totals = nursingTotals(feed, now);
            text = `${time(totals.total)} · L ${time(totals.left)} · R ${time(totals.right)}`;
          } catch {
            valid = false;
          }
          return (
            <Pressable
              key={String(log.id)}
              accessibilityRole="button"
              accessibilityLabel={`Nursing at ${format(log.start)}, ${text}`}
              disabled={blocked || !valid}
              onPress={() => openRecord(log)}
              style={styles.row}
            >
              <ActivityIcon name="nursing" color="#B35D7D" />
              <View style={styles.rowText}>
                <Text style={styles.label}>
                  {format(log.start)}
                  {log.isOpen ? ' · Running' : ''}
                </Text>
                <Text style={styles.copy}>{text}</Text>
              </View>
            </Pressable>
          );
        })}
        <Link href="/local" style={styles.link}>
          Separate on-device tracker
        </Link>
      </>
    );
  const sheetLog =
    drawer?.kind === 'edit'
      ? drawer.log
      : drawer?.kind === 'active'
        ? (model.current.find((log) => log.id === drawer.id) ?? null)
        : null;
  const sheetAllowed =
    drawer !== null && (drawer.kind === 'create' || sheetLog !== null) && !invalid;
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {content}
        {model.error ? (
          <View accessibilityRole="alert">
            <Text style={styles.error}>{model.error}</Text>
            {model.stage === 'email' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void model.signOut()}
                style={styles.link}
              >
                <Text>Clear saved sign-in</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      {model.stage === 'ready' && active && total ? (
        <View style={styles.live}>
          <ActivityLiveController
            accentColor="#B35D7D"
            accessibilityLabel="Open running Nursing"
            activityLabel={total.paused ? 'Nursing paused' : 'Nursing'}
            disabled={blocked}
            elapsedLabel={time(total.total)}
            icon="nursing"
            onOpen={() => openRecord(active)}
            onStop={() => void model.change(active, { kind: 'stop' })}
            stopAccessibilityLabel="Stop running Nursing"
          />
        </View>
      ) : null}
      {sheetAllowed && drawer ? (
        <NapperNursingSheet
          key={
            drawer.kind === 'edit'
              ? String(drawer.log.id)
              : drawer.kind === 'active'
                ? drawer.id
                : 'create'
          }
          log={sheetLog}
          now={now}
          timezone={model.timezone}
          last={last}
          busy={blocked}
          error={model.error}
          onClose={() => close(drawer)}
          onStart={(side, start) => {
            void model.start(side, start);
          }}
          onChange={(command) => {
            if (sheetLog)
              void model.change(sheetLog, command).then((success) => {
                if (success && command.kind === 'stop') close(drawer);
              });
          }}
          onCorrect={(start, end, left, last) => {
            if (sheetLog)
              void model.correct(sheetLog, start, end, left, last).then((success) => {
                if (success) close(drawer);
              });
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
function Button({
  label,
  onPress,
  busy,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy || disabled}
      onPress={onPress}
      style={[styles.button, (busy || disabled) && styles.disabled]}
    >
      <Text style={styles.white}>{busy ? 'Please wait…' : label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9F7F3' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#F9F7F3',
  },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  live: { paddingHorizontal: 16, paddingBottom: 8 },
  login: { paddingTop: 70, gap: 18 },
  title: { fontSize: 24, fontWeight: '700', color: '#292724' },
  copy: { fontSize: 13, color: '#746F68' },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: '#D8CFC5',
    borderRadius: 14,
    padding: 14,
    fontSize: 17,
    backgroundColor: '#FFFFFF',
  },
  button: {
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#B35D7D',
  },
  white: { color: '#FFFFFF', fontWeight: '700' },
  link: { minHeight: 44, paddingVertical: 12, color: '#5B4C94' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dates: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateText: { alignItems: 'center' },
  dateButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 26, color: '#746F68' },
  label: { fontSize: 15, fontWeight: '600', color: '#292724' },
  quickAction: {
    width: 60,
    height: 60,
    alignSelf: 'center',
    borderRadius: 30,
    backgroundColor: '#B35D7D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recency: { textAlign: 'center', fontSize: 12, color: '#746F68' },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  rowText: { gap: 4, flex: 1 },
  error: { color: '#A64444', fontSize: 14 },
  empty: { textAlign: 'center', color: '#746F68', padding: 24 },
  disabled: { opacity: 0.45 },
});
