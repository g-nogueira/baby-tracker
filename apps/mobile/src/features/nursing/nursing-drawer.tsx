import type { NursingSession, NursingSide } from '@baby-tracker/domain';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { formatLiveDuration } from '@/features/naps/nap-clock';
import { ActivityDrawer } from '@/features/shared/activity-drawer/activity-drawer';
import { nursingDrawerControls } from './nursing-drawer-state';
import { deriveNursingHomeModel } from './nursing-home-state';

interface NursingDrawerProps {
  activeSession: NursingSession | null;
  latestCompletedLast: NursingSide | null;
  isMutating: boolean;
  mutationError: string | null;
  onDismiss: () => void;
  onEdit: () => void;
  onPause: () => void;
  onResume: (side: NursingSide) => void;
  onStart: (side: NursingSide) => void;
  onStop: () => void;
  onSwitch: (side: NursingSide) => void;
}

const colors = {
  ink: '#292724',
  muted: '#746F68',
  border: '#E7E0D7',
  nursing: '#B35D7D',
  nursingSoft: '#F6E4EB',
  pause: '#665F58',
  danger: '#A64444',
};

/** Renders neutral start choices or controls for the exact persisted active Nursing session. */
export function NursingDrawer({
  activeSession,
  latestCompletedLast,
  isMutating,
  mutationError,
  onDismiss,
  onEdit,
  onPause,
  onResume,
  onStart,
  onStop,
  onSwitch,
}: NursingDrawerProps) {
  const now = useLiveNow(activeSession !== null);
  const model = deriveNursingHomeModel(activeSession, latestCompletedLast, now);
  const controller = model.controller;
  const controls = nursingDrawerControls(activeSession);

  return (
    <ActivityDrawer
      activityLabel="Nursing"
      mode={controls.mode === 'create' ? 'create' : 'active'}
      onDismiss={onDismiss}
      scrollContent
    >
      {({ expanded }) => (
        <>
          <View style={styles.hero}>
            <View style={styles.iconCircle}>
              <Text style={styles.icon}>N</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              Nursing
            </Text>
            {controller === null ? (
              <Text style={styles.guidanceCopy}>
                {latestCompletedLast === null
                  ? 'Choose either breast to start'
                  : 'Next is guidance — either breast can start'}
              </Text>
            ) : (
              <>
                <Text style={styles.totalValue}>
                  {formatSeconds(controller.totalDurationSeconds)}
                </Text>
                <Text style={styles.statusText}>
                  {controller.status === 'paused'
                    ? 'Paused'
                    : `${controller.activeSide === 'left' ? 'Left' : 'Right'} breast active`}
                </Text>
              </>
            )}
          </View>

          {controller === null || controls.mode === 'create' ? (
            <View style={styles.sideRow}>
              <SideButton
                guidance={model.guidance.left}
                isMutating={isMutating}
                onPress={() => onStart('left')}
                side="left"
              />
              <SideButton
                guidance={model.guidance.right}
                isMutating={isMutating}
                onPress={() => onStart('right')}
                side="right"
              />
            </View>
          ) : (
            <>
              <View style={styles.metrics}>
                <DurationMetric
                  active={controller.activeSide === 'left'}
                  label="Left"
                  seconds={controller.leftDurationSeconds}
                />
                <DurationMetric
                  active={controller.activeSide === 'right'}
                  label="Right"
                  seconds={controller.rightDurationSeconds}
                />
              </View>

              {controls.mode === 'active' ? (
                <View style={styles.activeActions}>
                  <ActionButton
                    disabled={isMutating}
                    label={`Switch to ${controls.switchTo === 'left' ? 'Left' : 'Right'}`}
                    onPress={() => onSwitch(controls.switchTo)}
                    primary
                  />
                  <ActionButton disabled={isMutating} label="Pause" onPress={onPause} />
                  <ActionButton disabled={isMutating} label="Stop" onPress={onStop} stop />
                </View>
              ) : (
                <>
                  <Text style={styles.resumeTitle}>Resume on</Text>
                  <View style={styles.sideRow}>
                    <SideButton
                      actionLabel="Resume"
                      guidance={null}
                      isMutating={isMutating}
                      onPress={() => onResume('left')}
                      side="left"
                    />
                    <SideButton
                      actionLabel="Resume"
                      guidance={null}
                      isMutating={isMutating}
                      onPress={() => onResume('right')}
                      side="right"
                    />
                  </View>
                  <ActionButton disabled={isMutating} label="Stop" onPress={onStop} stop />
                </>
              )}
            </>
          )}

          {!expanded ? <Text style={styles.swipeHint}>Swipe up for session details</Text> : null}
          {expanded ? (
            <View style={styles.details}>
              <Text style={styles.detailsTitle}>Session details</Text>
              {activeSession === null || controller === null ? (
                <Text style={styles.detailsText}>
                  The selected side starts immediately. You can switch, pause, or stop afterward.
                </Text>
              ) : (
                <>
                  <DetailRow label="Started" value={formatClock(activeSession.startedAt)} />
                  <ActionButton
                    disabled={isMutating}
                    label="Edit start time and split"
                    onPress={onEdit}
                  />
                  <DetailRow
                    label="Pause time"
                    value={formatSeconds(controller.pauseDurationSeconds)}
                  />
                  <DetailRow label="Last used" value={capitalize(activeSession.lastBreastUsed)} />
                </>
              )}
            </View>
          ) : null}

          {mutationError === null ? null : (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {mutationError}
            </Text>
          )}
        </>
      )}
    </ActivityDrawer>
  );
}

function SideButton({
  actionLabel = 'Start',
  guidance,
  isMutating,
  onPress,
  side,
}: {
  actionLabel?: 'Resume' | 'Start';
  guidance: 'Last' | 'Next' | null;
  isMutating: boolean;
  onPress: () => void;
  side: NursingSide;
}) {
  const label = capitalize(side);
  return (
    <Pressable
      accessibilityLabel={`${actionLabel} Nursing on ${label} breast${guidance === null ? '' : `, ${guidance}`}`}
      accessibilityRole="button"
      accessibilityState={{ busy: isMutating, disabled: isMutating }}
      disabled={isMutating}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sideButton,
        isMutating && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.sideLabel}>{label}</Text>
      {guidance === null ? null : <Text style={styles.guidanceBadge}>{guidance}</Text>}
      <Text style={styles.startLabel}>{actionLabel}</Text>
    </Pressable>
  );
}

function DurationMetric({
  active,
  label,
  seconds,
}: {
  active: boolean;
  label: string;
  seconds: number;
}) {
  return (
    <View style={[styles.metric, active && styles.metricActive]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{formatSeconds(seconds)}</Text>
      {active ? <Text style={styles.activeBadge}>Active</Text> : null}
    </View>
  );
}

function ActionButton({
  disabled,
  label,
  onPress,
  primary = false,
  stop = false,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  primary?: boolean;
  stop?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: disabled, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        primary && styles.primaryAction,
        stop && styles.stopAction,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.actionLabel,
          primary && styles.primaryActionLabel,
          stop && styles.stopActionLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function useLiveNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  const wasEnabled = useRef(enabled);
  const enablingNow = enabled && !wasEnabled.current ? new Date() : null;
  useEffect(() => {
    wasEnabled.current = enabled;
    if (!enabled) return;
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 1_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [enabled]);
  return enablingNow ?? now;
}

function formatSeconds(seconds: number): string {
  return formatLiveDuration(seconds * 1_000);
}

function formatClock(instant: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
  }).format(new Date(instant));
}

function capitalize(value: NursingSide): string {
  return value === 'left' ? 'Left' : 'Right';
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 5 },
  iconCircle: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    backgroundColor: colors.nursingSoft,
  },
  icon: { color: colors.nursing, fontSize: 20, fontWeight: '900' },
  title: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  guidanceCopy: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  totalValue: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: '500',
    letterSpacing: -0.7,
    fontVariant: ['tabular-nums'],
  },
  statusText: { color: colors.nursing, fontSize: 13, fontWeight: '700' },
  sideRow: { flexDirection: 'row', gap: 12 },
  sideButton: {
    flex: 1,
    minHeight: 86,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 18,
    backgroundColor: colors.nursing,
  },
  sideLabel: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  guidanceBadge: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  startLabel: { color: '#FBEFF4', fontSize: 12, fontWeight: '600' },
  metrics: { flexDirection: 'row', gap: 10 },
  metric: {
    flex: 1,
    minHeight: 76,
    padding: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
  },
  metricActive: { borderColor: colors.nursing, backgroundColor: colors.nursingSoft },
  metricLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  metricValue: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  activeBadge: {
    color: colors.nursing,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  activeActions: { flexDirection: 'row', gap: 8 },
  actionButton: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
  },
  primaryAction: { backgroundColor: colors.nursing, borderColor: colors.nursing },
  stopAction: { borderColor: '#E8CACA' },
  actionLabel: { color: colors.pause, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  primaryActionLabel: { color: '#FFFFFF' },
  stopActionLabel: { color: colors.danger },
  resumeTitle: { color: colors.muted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  swipeHint: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  details: { gap: 8, paddingTop: 4 },
  detailsTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  detailsText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  detailRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailLabel: { color: colors.muted, fontSize: 13 },
  detailValue: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
});
