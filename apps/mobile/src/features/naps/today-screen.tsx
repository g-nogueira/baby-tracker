import {
  type CareEvent,
  elapsedMilliseconds,
  formatDuration,
  type NapSession,
  type NightSleepSession,
  type NursingSession,
} from '@baby-tracker/domain';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { CareEventDrawer } from '@/features/care-events/care-event-drawer';
import {
  type CareEventDrawerState,
  createCareEventDraft,
  editCareEventDraft,
} from '@/features/care-events/care-event-drawer-state';
import { appendCareEventHomeActions } from '@/features/care-events/care-event-home-state';
import { useCareEvents } from '@/features/care-events/use-care-events';
import { CompletedNursingEditorDrawer } from '@/features/nursing/completed-nursing-editor-drawer';
import {
  type CompletedNursingEditorState,
  completedNursingCorrectionForSave,
  createCompletedNursingEditorState,
} from '@/features/nursing/completed-nursing-editor-state';
import { NursingDrawer } from '@/features/nursing/nursing-drawer';
import { completedNursingRecordById } from '@/features/nursing/nursing-history-state';
import {
  combinedPendingOperationCount,
  decideNursingDrawerCommand,
  liveControllerIdentities,
} from '@/features/nursing/nursing-home-integration-state';
import {
  appendNursingHomeAction,
  deriveNursingHomeModel,
  type NursingControllerModel,
} from '@/features/nursing/nursing-home-state';
import { useNursing } from '@/features/nursing/use-nursing';
import {
  type HomeQuickAction,
  HomeQuickActions,
} from '@/features/shared/home-actions/home-quick-actions';
import { ActivityLiveController } from '@/features/shared/live-controller/activity-live-controller';
import { minimumLiveControllerStackHeight } from '@/features/shared/live-controller/activity-live-controller-layout';
import { ActivityLiveControllerStack } from '@/features/shared/live-controller/activity-live-controller-stack';
import { liveControllerReservedSpace } from '@/features/shared/live-controller/activity-live-controller-stack-state';
import { NightRecordEditorDrawer } from '@/features/sleep/night-record-editor-drawer';
import {
  createNightRecordEditorState,
  type NightRecordEditorState,
  nightRecordBoundariesForSave,
} from '@/features/sleep/night-record-editor-state';
import { NightTransitionDrawer } from '@/features/sleep/night-transition-drawer';
import {
  createNightTransitionDraft,
  type NightTransitionDraft,
} from '@/features/sleep/night-transition-drawer-state';
import {
  deriveSleepHomeModel,
  type SleepHomeActionKind,
  type SleepHomeControllerModel,
} from '@/features/sleep/sleep-home-state';
import {
  RadialCycle,
  type RadialCycleSelection,
  RadialCycleSelector,
  radialActivityColor,
} from '@/features/timeline/radial-cycle';
import {
  buildRadialCycleViews,
  type ProjectedRadialActivity,
} from '@/features/timeline/radial-cycle-state';
import { formatLiveDuration } from './nap-clock';
import { NapEditorSheet } from './nap-editor-sheet';
import type { NapEditorState } from './nap-editor-state';
import { useNaps } from './use-naps';

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
});
const dayFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const palette = {
  background: '#F7F4EF',
  surface: '#FFFFFF',
  ink: '#292724',
  muted: '#746F68',
  nap: '#7367B9',
  napSoft: '#E8E4F7',
  danger: '#A64444',
  border: '#E7E0D7',
};

type UndoState =
  | { kind: 'nap'; deletedNap: NapSession }
  | { kind: 'night'; deletedSession: NightSleepSession }
  | { kind: 'care-event'; deletedEvent: CareEvent }
  | { kind: 'nursing'; deletedSession: NursingSession };

/**
 * Displays the nap timeline for the selected day and provides controls for navigating, creating, editing, deleting, and restoring naps.
 */
export function TodayScreen() {
  const insets = useSafeAreaInsets();
  const {
    activeNap,
    activeSleep,
    clearError: clearSleepError,
    edit,
    editNight,
    endNight,
    error: sleepError,
    isLoading: isSleepLoading,
    isMutating: isSleepMutating,
    isToday,
    latestCompletedEnd,
    nextDay,
    pendingOperationCount: sleepPendingOperationCount,
    previousDay,
    goToToday,
    remove,
    removeNight,
    restore,
    restoreNight,
    resumeNight,
    selectedDay,
    sleepSessions,
    start,
    startNight,
    startNightWaking,
    stop,
  } = useNaps();
  const {
    activeSession: activeNursing,
    clearError: clearNursingError,
    cycleSessions: cycleNursingSessions,
    error: nursingError,
    editCompleted: editCompletedNursing,
    isLoading: isNursingLoading,
    isMutating: isNursingMutating,
    latestCompletedLast,
    pause: pauseNursing,
    pendingOperationCount: nursingPendingOperationCount,
    removeCompleted: removeCompletedNursing,
    resume: resumeNursing,
    restoreCompleted: restoreCompletedNursing,
    start: startNursing,
    stop: stopNursing,
    switchSide: switchNursing,
  } = useNursing(selectedDay);
  const {
    clearError: clearCareEventError,
    cycleEvents,
    createDiaper,
    createMedicine,
    editDiaper,
    editMedicine,
    error: careEventError,
    isLoading: isCareEventLoading,
    isMutating: isCareEventMutating,
    pendingOperationCount: careEventPendingOperationCount,
    remove: removeCareEvent,
    restore: restoreCareEvent,
  } = useCareEvents(selectedDay);
  const now = useAdaptiveClock(activeSleep !== null || activeNursing !== null);
  const [editor, setEditor] = useState<NapEditorState | null>(null);
  const [nightDraft, setNightDraft] = useState<NightTransitionDraft | null>(null);
  const [nightEditor, setNightEditor] = useState<NightRecordEditorState | null>(null);
  const [chosenCycle, setCycleSelection] = useState<RadialCycleSelection | null>(null);
  const cycleSelection =
    chosenCycle ?? (isToday && activeSleep?.kind === 'night' ? 'night' : 'day');
  const [nursingDrawerOpen, setNursingDrawerOpen] = useState(false);
  const [nursingEditor, setNursingEditor] = useState<CompletedNursingEditorState | null>(null);
  const [careEventDrawer, setCareEventDrawer] = useState<CareEventDrawerState | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [controllerReservedSpace, setControllerReservedSpace] = useState(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (undo === null) return;
    let cancelled = false;
    AccessibilityInfo.announceForAccessibility(`${undoRecordLabel(undo)} deleted. Undo available.`);
    AccessibilityInfo.getRecommendedTimeoutMillis(5_000)
      .catch(() => 5_000)
      .then((timeout) => {
        if (!cancelled) undoTimer.current = setTimeout(() => setUndo(null), timeout);
      });
    return () => {
      cancelled = true;
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    };
  }, [undo]);

  if (isSleepLoading || isNursingLoading || isCareEventLoading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={palette.nap} size="large" />
      </SafeAreaView>
    );
  }

  const activeUndoPending = undo?.kind === 'nap' && undo.deletedNap.status === 'active';
  const homeModel = deriveSleepHomeModel(activeSleep, latestCompletedEnd);
  const nursingModel = deriveNursingHomeModel(activeNursing, latestCompletedLast, now);
  const nursingController = nursingModel.controller;
  const cycleViews = buildRadialCycleViews({
    showActiveNight: isToday,
    careEvents: cycleEvents,
    childId: LOCAL_DEVELOPMENT_IDENTITY.childId,
    localDate: selectedDay,
    now,
    nursingSessions: cycleNursingSessions,
    sleepSessions,
    timezone: LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
  });
  const selectedCycle = cycleViews[cycleSelection];
  const cycleRecordCount = selectedCycle.records.length;
  const activeController = homeModel.controller;
  const liveControllers = liveControllerIdentities(
    activeSleep?.id ?? null,
    nursingController?.sessionId ?? null,
  );
  const hasLiveController = liveControllers.length > 0;
  const pendingOperationCount = combinedPendingOperationCount(
    combinedPendingOperationCount(sleepPendingOperationCount, nursingPendingOperationCount),
    careEventPendingOperationCount,
  );
  const controllerFallbackSpace = liveControllerReservedSpace(
    insets.bottom,
    undo !== null,
    minimumLiveControllerStackHeight(liveControllers.length),
  );
  const contentBottomPadding = Math.max(
    80,
    hasLiveController ? Math.max(controllerReservedSpace, controllerFallbackSpace) : 0,
    undo === null ? 0 : 194,
  );

  const openNapControls = () => {
    clearSleepError();
    setEditor(
      activeNap === null
        ? { mode: 'start', startedAt: new Date() }
        : { mode: 'stop', nap: activeNap, endedAt: new Date() },
    );
  };

  const openSleepAction = (kind: SleepHomeActionKind) => {
    clearSleepError();
    if (kind === 'start-nap' || kind === 'open-current-nap') {
      openNapControls();
      return;
    }
    const session = activeSleep?.kind === 'night' ? activeSleep : null;
    setNightEditor(null);
    setNightDraft(createNightTransitionDraft(kind, session, new Date()));
  };

  const saveNightDraft = async (draft: NightTransitionDraft) => {
    const saved =
      draft.kind === 'start-night-sleep'
        ? await startNight(draft.effectiveAt)
        : draft.kind === 'start-night-waking'
          ? await startNightWaking(draft.effectiveAt, draft.session)
          : draft.kind === 'resume-night-sleep'
            ? await resumeNight(draft.effectiveAt, draft.session)
            : await endNight(draft.effectiveAt, draft.session);
    if (saved !== null) {
      setNightDraft(null);
      setCycleSelection(saved.status === 'active' ? 'night' : 'day');
    }
  };

  const openNapRecord = (napId: string) => {
    const nap = sleepSessions.find(
      (candidate): candidate is NapSession => candidate.kind === 'nap' && candidate.id === napId,
    );
    if (nap === undefined) return;
    clearSleepError();
    setEditor({
      mode: 'edit',
      nap,
      startedAt: new Date(nap.startedAt),
      endedAt: nap.endedAt === null ? null : new Date(nap.endedAt),
    });
  };

  const saveEditor = async (candidate: NapEditorState) => {
    const saved =
      candidate.mode === 'start'
        ? await start(candidate.startedAt)
        : candidate.mode === 'stop'
          ? await stop(candidate.endedAt)
          : await edit(candidate.nap, candidate.startedAt, candidate.endedAt);
    if (saved !== null) setEditor(null);
  };

  const deleteFromEditor = async () => {
    if (editor === null || editor.mode === 'start') return;
    const deletedNap = await remove(editor.nap);
    if (deletedNap === null) return;
    setEditor(null);
    setUndo({ kind: 'nap', deletedNap });
  };

  const undoDelete = async () => {
    if (undo === null) return;
    const restored = await (undo.kind === 'nap'
      ? restore(undo.deletedNap)
      : undo.kind === 'night'
        ? restoreNight(undo.deletedSession)
        : undo.kind === 'nursing'
          ? restoreCompletedNursing(undo.deletedSession)
          : restoreCareEvent(undo.deletedEvent));
    if (restored !== null) setUndo(null);
  };

  const openNursingRecord = (sessionId: string) => {
    const session = completedNursingRecordById(cycleNursingSessions, sessionId);
    if (session === null) return;
    clearNursingError();
    setNursingDrawerOpen(false);
    setNursingEditor(createCompletedNursingEditorState(session));
  };

  const openNightRecord = (
    session: NightSleepSession,
    phaseId: string | null = null,
    mode: 'active' | 'edit' = 'edit',
  ) => {
    clearSleepError();
    setNightDraft(null);
    setNightEditor(createNightRecordEditorState(session, phaseId, mode));
  };

  const saveNightEditor = async (candidate: NightRecordEditorState) => {
    const saved = await editNight(candidate.session, nightRecordBoundariesForSave(candidate));
    if (saved !== null) setNightEditor(null);
  };

  const deleteNightEditor = async () => {
    if (nightEditor === null) return;
    const deletedSession = await removeNight(nightEditor.session);
    if (deletedSession === null) return;
    setNightEditor(null);
    setUndo({ kind: 'night', deletedSession });
  };

  const saveNursingEditor = async (candidate: CompletedNursingEditorState) => {
    const correction = completedNursingCorrectionForSave(candidate);
    const saved = await editCompletedNursing(candidate.session, correction);
    if (saved !== null) setNursingEditor(null);
  };

  const deleteNursingEditor = async () => {
    if (nursingEditor === null) return;
    const deletedSession = await removeCompletedNursing(nursingEditor.session);
    if (deletedSession === null) return;
    setNursingEditor(null);
    setUndo({ kind: 'nursing', deletedSession });
  };

  const openCareEventCreate = (kind: 'diaper' | 'medicine') => {
    clearCareEventError();
    setCareEventDrawer(createCareEventDraft(kind));
  };

  const openCareEventRecord = (eventId: string) => {
    const event = cycleEvents.find((candidate) => candidate.id === eventId);
    if (event === undefined) return;
    clearCareEventError();
    setCareEventDrawer(editCareEventDraft(event));
  };

  const saveCareEvent = async (draft: CareEventDrawerState) => {
    const saved =
      draft.mode === 'create'
        ? draft.kind === 'diaper'
          ? draft.diaperType === null
            ? null
            : await createDiaper(draft.diaperType, draft.occurredAt)
          : await createMedicine(draft.note, draft.occurredAt)
        : draft.kind === 'diaper'
          ? await editDiaper(draft.event, draft.diaperType, draft.occurredAt)
          : await editMedicine(draft.event, draft.note, draft.occurredAt);
    if (saved !== null) setCareEventDrawer(null);
  };

  const deleteCareEventFromDrawer = async () => {
    if (careEventDrawer === null || careEventDrawer.mode !== 'edit') return;
    const deletedEvent = await removeCareEvent(careEventDrawer.event);
    if (deletedEvent === null) return;
    setCareEventDrawer(null);
    setUndo({ kind: 'care-event', deletedEvent });
  };

  const openNursingControls = (sessionId?: string) => {
    const decision = decideNursingDrawerCommand(
      activeNursing?.id ?? null,
      sessionId === undefined ? { kind: 'open' } : { kind: 'open', sessionId },
    );
    if (!decision.drawerOpen) return;
    if (decision.clearError) clearNursingError();
    setNursingEditor(null);
    setNursingDrawerOpen(decision.drawerOpen);
  };

  const openRadialRecord = (record: ProjectedRadialActivity) => {
    if (record.kind === 'nap') {
      openNapRecord(record.editorRecordId);
      return;
    }
    if (record.kind === 'nursing') {
      if (activeNursing?.id === record.editorRecordId) openNursingControls(record.editorRecordId);
      else openNursingRecord(record.editorRecordId);
      return;
    }
    if (record.kind === 'diaper' || record.kind === 'medicine') {
      openCareEventRecord(record.editorRecordId);
      return;
    }
    const night = sleepSessions.find((session) => session.id === record.editorRecordId);
    if (night?.kind !== 'night') return;
    openNightRecord(night, record.kind === 'night-waking' ? record.id : null);
  };

  const runNursingTransition = async (
    transition: Promise<NursingSession | null>,
    announcement: string,
    onSuccess?: () => void,
  ) => {
    const saved = await transition;
    if (saved === null) return;
    AccessibilityInfo.announceForAccessibility(announcement);
    onSuccess?.();
  };

  const centerStatus = isToday
    ? {
        label: homeModel.center.label,
        value:
          homeModel.center.durationStartedAt === null
            ? null
            : formatDuration(elapsedMilliseconds(homeModel.center.durationStartedAt, now)),
        hint: homeModel.center.hint,
      }
    : {
        label: `${cycleRecordCount} ${cycleRecordCount === 1 ? 'record' : 'records'}`,
        value: null,
        hint: 'Recorded on this day',
      };
  const quickActions: HomeQuickAction[] = appendCareEventHomeActions(
    appendNursingHomeAction(homeModel.actions, nursingModel.action),
  ).map((action) => {
    if (action.kind === 'nursing') {
      return {
        id: action.kind,
        label: action.label,
        meta: action.meta,
        icon: 'N',
        color: '#B35D7D',
        disabled: isNursingMutating,
        disabledReason: isNursingMutating ? 'A Nursing change is being saved.' : null,
        active: action.active,
        onPress: () => openNursingControls(),
      };
    }
    if (action.kind === 'medicine' || action.kind === 'diaper') {
      return {
        id: action.kind,
        label: action.label,
        meta: action.meta,
        icon: action.kind === 'medicine' ? '+' : 'D',
        color: action.kind === 'medicine' ? '#A65F35' : '#47735A',
        disabled: isCareEventMutating,
        disabledReason: isCareEventMutating ? 'A care event is being saved.' : null,
        active: false,
        onPress: () => openCareEventCreate(action.kind),
      };
    }
    return {
      id: action.kind,
      label: action.label,
      meta: actionMeta(action.kind),
      icon: actionIcon(action.kind),
      color: actionColor(action.kind),
      disabled: isSleepMutating || activeUndoPending || action.disabledReason !== null,
      disabledReason:
        action.disabledReason ??
        (isSleepMutating ? 'A sleep change is being saved.' : null) ??
        (activeUndoPending ? 'Restore or finish the pending Undo first.' : null),
      active: action.kind === 'open-current-nap',
      onPress: () => openSleepAction(action.kind),
    };
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: contentBottomPadding }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>{isToday ? 'TODAY' : 'HISTORY'}</Text>
            <Text style={styles.title}>{LOCAL_DEVELOPMENT_IDENTITY.childDisplayName}</Text>
          </View>
          {pendingOperationCount > 0 ? (
            <View
              accessibilityLabel={`${pendingOperationCount} changes waiting to sync`}
              style={styles.syncPill}
            >
              <View style={styles.syncDot} />
              <Text style={styles.syncText}>On device · {pendingOperationCount} to sync</Text>
            </View>
          ) : null}
        </View>

        {sleepError ? (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.errorText}>{sleepError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={clearSleepError}
              style={styles.dismissError}
            >
              <Text style={styles.dismissErrorText}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        {nursingError ? (
          <View accessibilityRole="alert" style={styles.nursingErrorBanner}>
            <Text style={styles.nursingErrorText}>Nursing · {nursingError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={clearNursingError}
              style={styles.dismissError}
            >
              <Text style={styles.nursingDismissErrorText}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        {careEventError ? (
          <View accessibilityRole="alert" style={styles.careEventErrorBanner}>
            <Text style={styles.careEventErrorText}>Care event · {careEventError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={clearCareEventError}
              style={styles.dismissError}
            >
              <Text style={styles.careEventDismissErrorText}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        <RadialCycleSelector onChange={setCycleSelection} selection={cycleSelection} />
        <RadialCycle
          centerStatus={centerStatus}
          disabled={isSleepMutating || isNursingMutating || isCareEventMutating}
          onPressRecord={openRadialRecord}
          view={selectedCycle}
        />

        {isToday ? <HomeQuickActions actions={quickActions} /> : null}

        {!isToday ? (
          <Pressable accessibilityRole="button" onPress={goToToday} style={styles.todayButton}>
            <Text style={styles.todayButtonText}>Return to today</Text>
          </Pressable>
        ) : null}

        <View style={styles.dateNavigation}>
          <Pressable
            accessibilityLabel="Show previous day"
            accessibilityRole="button"
            onPress={previousDay}
            style={styles.dateButton}
          >
            <Text style={styles.dateButtonText}>‹</Text>
          </Pressable>
          <View style={styles.dateLabel}>
            <Text style={styles.sectionTitle}>
              {cycleSelection === 'day' ? 'Day log' : 'Night log'}
            </Text>
            <Text style={styles.sectionMeta}>
              {isToday ? 'Today' : dayFormatter.format(new Date(`${selectedDay}T12:00:00.000Z`))}
              {' · '}
              {cycleRecordCount} {cycleRecordCount === 1 ? 'record' : 'records'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Show next day"
            accessibilityRole="button"
            accessibilityState={{ disabled: isToday }}
            disabled={isToday}
            onPress={nextDay}
            style={[styles.dateButton, isToday && styles.disabled]}
          >
            <Text style={styles.dateButtonText}>›</Text>
          </Pressable>
        </View>

        <View style={styles.timeline}>
          {selectedCycle.records.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>
                No {cycleSelection === 'day' ? 'Day' : 'Night'} activity in this cycle
              </Text>
              <Text style={styles.emptyText}>
                {isToday
                  ? `Use an action above when ${LOCAL_DEVELOPMENT_IDENTITY.childDisplayName} sleeps or needs care.`
                  : 'Use the arrows to review another day.'}
              </Text>
            </View>
          ) : (
            selectedCycle.records.map((record) => (
              <CycleLogRow
                key={`${record.kind}:${record.id}`}
                onEdit={() => openRadialRecord(record)}
                record={record}
              />
            ))
          )}
        </View>
      </ScrollView>

      {hasLiveController ? (
        <ActivityLiveControllerStack
          onReservedSpaceChange={setControllerReservedSpace}
          raised={undo !== null}
        >
          {activeSleep?.kind === 'nap' && activeController?.kind === 'nap' ? (
            <ActiveNapTimer
              isMutating={isSleepMutating}
              nap={activeSleep}
              now={now}
              onOpen={openNapControls}
              onStop={() => void stop()}
            />
          ) : activeSleep?.kind === 'night' &&
            activeController !== null &&
            activeController.kind !== 'nap' ? (
            <ActiveNightTimer
              controller={activeController}
              isMutating={isSleepMutating}
              now={now}
              onEnd={() => {
                void endNight().then((saved) => {
                  if (saved !== null) setCycleSelection('day');
                });
              }}
              onOpen={() =>
                openNightRecord(
                  activeSleep,
                  activeController.kind === 'night-awake'
                    ? (activeSleep.phases.at(-1)?.id ?? null)
                    : null,
                  'active',
                )
              }
              onResume={() => void resumeNight()}
            />
          ) : null}
          {activeNursing !== null && nursingController !== null ? (
            <ActiveNursingTimer
              isMutating={isNursingMutating}
              model={nursingController}
              onOpen={() => openNursingControls(nursingController.sessionId)}
              onStop={() => void stopNursing()}
            />
          ) : null}
        </ActivityLiveControllerStack>
      ) : null}

      {undo !== null ? (
        <View accessibilityLiveRegion="polite" style={styles.undoBanner}>
          <Text style={styles.undoText}>{undoRecordLabel(undo)} deleted</Text>
          <Pressable
            accessibilityHint={`Restores the deleted ${undoRecordLabel(undo).toLocaleLowerCase()} with the same identifier`}
            accessibilityRole="button"
            disabled={undoMutationPending(
              undo,
              isSleepMutating,
              isNursingMutating,
              isCareEventMutating,
            )}
            onPress={() => void undoDelete()}
            style={styles.undoButton}
          >
            <Text style={styles.undoButtonText}>Undo</Text>
          </Pressable>
        </View>
      ) : null}

      {editor !== null ? (
        <NapEditorSheet
          editor={editor}
          isMutating={isSleepMutating}
          mutationError={sleepError}
          onCancel={() => setEditor(null)}
          onChange={(nextEditor) => {
            clearSleepError();
            setEditor(nextEditor);
          }}
          onDelete={editor.mode === 'start' ? null : () => void deleteFromEditor()}
          onSave={(candidate) => void saveEditor(candidate)}
        />
      ) : null}

      {nightDraft !== null ? (
        <NightTransitionDrawer
          draft={nightDraft}
          isMutating={isSleepMutating}
          mutationError={sleepError}
          onCancel={() => setNightDraft(null)}
          onChange={(draft) => {
            clearSleepError();
            setNightDraft(draft);
          }}
          onSave={(draft) => void saveNightDraft(draft)}
        />
      ) : null}

      {nightEditor !== null ? (
        <NightRecordEditorDrawer
          editor={nightEditor}
          isMutating={isSleepMutating}
          mutationError={sleepError}
          onCancel={() => setNightEditor(null)}
          onChange={(candidate) => {
            clearSleepError();
            setNightEditor(candidate);
          }}
          onDelete={
            nightEditor.phaseId === null && nightEditor.session.status === 'completed'
              ? () => void deleteNightEditor()
              : null
          }
          now={now}
          onFinish={() => {
            const result =
              nightEditor.phaseId === null
                ? endNight(undefined, nightEditor.session)
                : resumeNight(undefined, nightEditor.session);
            void result.then((saved) => {
              if (saved !== null) {
                setNightEditor(null);
                setCycleSelection(saved.status === 'active' ? 'night' : 'day');
              }
            });
          }}
          onSave={(candidate) => void saveNightEditor(candidate)}
        />
      ) : null}

      {nursingEditor !== null ? (
        <CompletedNursingEditorDrawer
          editor={nursingEditor}
          isMutating={isNursingMutating}
          mutationError={nursingError}
          onCancel={() => setNursingEditor(null)}
          onChange={(candidate) => {
            clearNursingError();
            setNursingEditor(candidate);
          }}
          onDelete={() => void deleteNursingEditor()}
          onSave={(candidate) => void saveNursingEditor(candidate)}
        />
      ) : null}

      {nursingDrawerOpen ? (
        <NursingDrawer
          activeSession={activeNursing}
          isMutating={isNursingMutating}
          latestCompletedLast={latestCompletedLast}
          mutationError={nursingError}
          onDismiss={() =>
            setNursingDrawerOpen(
              decideNursingDrawerCommand(activeNursing?.id ?? null, { kind: 'dismiss' }).drawerOpen,
            )
          }
          onPause={() => void runNursingTransition(pauseNursing(), 'Nursing paused')}
          onResume={(side) =>
            void runNursingTransition(
              resumeNursing(side),
              `Nursing resumed on ${side === 'left' ? 'Left' : 'Right'} breast`,
            )
          }
          onStart={(side) =>
            void runNursingTransition(
              startNursing(side),
              `Nursing started on ${side === 'left' ? 'Left' : 'Right'} breast`,
            )
          }
          onStop={() => {
            void runNursingTransition(stopNursing(), 'Nursing stopped', () =>
              setNursingDrawerOpen(false),
            );
          }}
          onSwitch={(side) =>
            void runNursingTransition(
              switchNursing(side),
              `Nursing switched to ${side === 'left' ? 'Left' : 'Right'} breast`,
            )
          }
        />
      ) : null}

      {careEventDrawer !== null ? (
        <CareEventDrawer
          draft={careEventDrawer}
          isMutating={isCareEventMutating}
          mutationError={careEventError}
          onCancel={() => setCareEventDrawer(null)}
          onChange={(draft) => {
            clearCareEventError();
            setCareEventDrawer(draft);
          }}
          onDelete={careEventDrawer.mode === 'edit' ? () => void deleteCareEventFromDrawer() : null}
          onSave={(draft) => void saveCareEvent(draft)}
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * Displays the currently active nap with its elapsed duration and controls for editing or stopping it.
 *
 * @param isMutating - Whether nap controls should be disabled during a mutation.
 * @param nap - The active nap session.
 * @param now - The current time used to calculate elapsed duration.
 * @param onOpen - Called when the nap editor is opened.
 * @param onStop - Called when the active nap is stopped.
 */
function ActiveNapTimer({
  isMutating,
  nap,
  now,
  onOpen,
  onStop,
}: {
  isMutating: boolean;
  nap: NapSession;
  now: Date;
  onOpen: () => void;
  onStop: () => void;
}) {
  const liveDuration = formatLiveDuration(elapsedMilliseconds(nap.startedAt, now));
  return (
    <ActivityLiveController
      accentColor={palette.nap}
      accessibilityLabel={`Nap running for ${liveDuration}`}
      activityLabel="Nap"
      disabled={isMutating}
      elapsedLabel={liveDuration}
      icon="z"
      onOpen={onOpen}
      onStop={onStop}
      stopAccessibilityLabel="Stop nap now"
    />
  );
}

/** Displays the active Night phase while retaining session-level elapsed time where required. */
function ActiveNightTimer({
  controller,
  isMutating,
  now,
  onEnd,
  onOpen,
  onResume,
}: {
  controller: Exclude<SleepHomeControllerModel, { kind: 'nap' }>;
  isMutating: boolean;
  now: Date;
  onEnd: () => void;
  onOpen: () => void;
  onResume: () => void;
}) {
  const awake = controller.kind === 'night-awake';
  const liveDuration = formatLiveDuration(elapsedMilliseconds(controller.durationStartedAt, now));
  return (
    <ActivityLiveController
      accentColor={awake ? '#52728A' : '#5B4C94'}
      accessibilityLabel={`${awake ? 'Night waking' : 'Night sleep'} running for ${liveDuration}`}
      actionIcon={awake ? 'z' : '☀'}
      activityLabel={awake ? 'Night waking' : 'Night sleep'}
      disabled={isMutating}
      elapsedLabel={liveDuration}
      icon={awake ? '↯' : '☾'}
      onOpen={onOpen}
      onStop={controller.primaryAction === 'resume-night-sleep' ? onResume : onEnd}
      stopAccessibilityLabel={awake ? 'Fell asleep again now' : 'Wake up now'}
      subtitle={awake ? 'Awake tonight' : undefined}
    />
  );
}

/** Displays persisted Nursing side totals and reopens the exact active or paused session. */
function ActiveNursingTimer({
  isMutating,
  model,
  onOpen,
  onStop,
}: {
  isMutating: boolean;
  model: NursingControllerModel;
  onOpen: () => void;
  onStop: () => void;
}) {
  const total = formatLiveDuration(model.totalDurationSeconds * 1_000);
  const left = formatLiveDuration(model.leftDurationSeconds * 1_000);
  const right = formatLiveDuration(model.rightDurationSeconds * 1_000);
  const status =
    model.status === 'paused'
      ? 'Paused'
      : `${model.activeSide === 'left' ? 'Left' : 'Right'} active`;
  return (
    <ActivityLiveController
      accentColor="#B35D7D"
      accessibilityLabel={`Nursing ${status.toLocaleLowerCase()}, total ${total}, Left ${left}, Right ${right}`}
      activityLabel="Nursing"
      disabled={isMutating}
      elapsedLabel={total}
      icon="N"
      onOpen={onOpen}
      onStop={onStop}
      stopAccessibilityLabel="Stop Nursing now"
      subtitle={`L ${left} · R ${right} · ${status}`}
    />
  );
}

function actionMeta(kind: SleepHomeActionKind): string {
  switch (kind) {
    case 'open-current-nap':
      return 'Running';
    case 'end-night-sleep':
      return 'End Night';
    case 'start-night-waking':
      return 'Awake phase';
    case 'resume-night-sleep':
      return 'Resume sleep';
    default:
      return 'Start';
  }
}

function actionIcon(kind: SleepHomeActionKind): string {
  switch (kind) {
    case 'start-night-sleep':
      return '☾';
    case 'start-nap':
    case 'open-current-nap':
    case 'resume-night-sleep':
      return 'z';
    case 'end-night-sleep':
      return '☀';
    case 'start-night-waking':
      return '↯';
  }
}

function actionColor(kind: SleepHomeActionKind): string {
  switch (kind) {
    case 'start-night-sleep':
    case 'end-night-sleep':
      return '#5B4C94';
    case 'start-night-waking':
      return '#52728A';
    default:
      return palette.nap;
  }
}

/** Precision and screen-reader equivalent of one selected radial record. */
function CycleLogRow({ onEdit, record }: { onEdit: () => void; record: ProjectedRadialActivity }) {
  const title = cycleRecordTitle(record);
  const detail = cycleRecordDetail(record);
  return (
    <Pressable
      accessibilityLabel={`Edit ${title}, ${detail}`}
      accessibilityRole="button"
      onPress={onEdit}
      style={({ pressed }) => [styles.timelineRow, pressed && styles.rowPressed]}
    >
      <View
        style={[styles.timelineMarker, { backgroundColor: radialActivityColor(record.kind) }]}
      />
      <View style={styles.timelineBody}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowTime}>{detail}</Text>
        </View>
        <Text style={[styles.editText, { color: radialActivityColor(record.kind) }]}>Edit</Text>
      </View>
    </Pressable>
  );
}

function cycleRecordTitle(record: ProjectedRadialActivity): string {
  if (record.kind === 'night') return 'Night sleep';
  if (record.kind === 'night-waking') return 'Night waking';
  if (record.kind === 'nursing') return `Nursing${record.status === 'paused' ? ' · paused' : ''}`;
  if (record.kind === 'diaper') return `Diaper · ${capitalize(record.diaperType ?? 'unknown')}`;
  return capitalize(record.kind);
}

function cycleRecordDetail(record: ProjectedRadialActivity): string {
  const start = clockFormatter.format(new Date(record.occurredAt));
  if (record.projection.type === 'point') {
    return record.kind === 'medicine' && record.medicineNote !== undefined
      ? `${start} · ${record.medicineNote}`
      : start;
  }
  const end = record.endedAt === null ? 'now' : clockFormatter.format(new Date(record.endedAt));
  const duration = formatDuration(record.projection.arc?.actualDurationMs ?? 0);
  return `${start} – ${end} · ${duration}`;
}

function undoRecordLabel(undo: UndoState): string {
  if (undo.kind === 'nap') return 'Nap';
  if (undo.kind === 'night') return 'Night sleep';
  if (undo.kind === 'nursing') return 'Nursing session';
  return undo.deletedEvent.kind === 'diaper' ? 'Diaper' : 'Medicine';
}

function undoMutationPending(
  undo: UndoState,
  sleepPending: boolean,
  nursingPending: boolean,
  careEventPending: boolean,
): boolean {
  if (undo.kind === 'nap') return sleepPending;
  if (undo.kind === 'night') return sleepPending;
  if (undo.kind === 'nursing') return nursingPending;
  return careEventPending;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

/**
 * Tracks the current time with an update interval suited to the display precision.
 *
 * @param showSeconds - Whether to update every second instead of every minute
 * @returns The current date and time
 */
function useAdaptiveClock(showSeconds: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), showSeconds ? 1_000 : 60_000);
    setNow(new Date());
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [showSeconds]);

  return now;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.background,
  },
  content: { paddingHorizontal: 20, paddingBottom: 80, gap: 18 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 54,
  },
  eyebrow: { color: palette.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: palette.ink, fontSize: 28, fontWeight: '700', letterSpacing: -0.6 },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    minHeight: 34,
    borderRadius: 17,
    backgroundColor: palette.surface,
  },
  syncDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#CB8A3A' },
  syncText: { color: palette.muted, fontSize: 11, fontWeight: '600' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: '#F9E5E2',
    borderRadius: 14,
  },
  errorText: { flex: 1, color: palette.danger, fontSize: 14 },
  nursingErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: '#F6E4EB',
    borderRadius: 14,
  },
  nursingErrorText: { flex: 1, color: '#8D3E5C', fontSize: 14 },
  careEventErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: '#F8E9DE',
    borderRadius: 14,
  },
  careEventErrorText: { flex: 1, color: '#8B4B2C', fontSize: 14 },
  dismissError: { minHeight: 44, justifyContent: 'center' },
  dismissErrorText: { color: palette.danger, fontSize: 13, fontWeight: '700' },
  nursingDismissErrorText: { color: '#8D3E5C', fontSize: 13, fontWeight: '700' },
  careEventDismissErrorText: { color: '#8B4B2C', fontSize: 13, fontWeight: '700' },
  todayButton: {
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: palette.napSoft,
  },
  todayButtonText: { color: palette.nap, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  dateNavigation: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  dateButtonText: { color: palette.nap, fontSize: 28, lineHeight: 31 },
  dateLabel: { flex: 1, alignItems: 'center' },
  sectionTitle: { color: palette.ink, fontSize: 19, fontWeight: '700' },
  sectionMeta: { color: palette.muted, fontSize: 13, marginTop: 2 },
  timeline: {
    borderRadius: 20,
    backgroundColor: palette.surface,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.border,
  },
  emptyState: { padding: 24, alignItems: 'center' },
  emptyTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  emptyText: { color: palette.muted, fontSize: 14, marginTop: 5, textAlign: 'center' },
  timelineRow: { minHeight: 76, flexDirection: 'row', alignItems: 'stretch', paddingLeft: 18 },
  rowPressed: { backgroundColor: '#FAF8F5' },
  timelineMarker: { width: 4, borderRadius: 2, backgroundColor: palette.nap, marginVertical: 16 },
  timelineBody: {
    flex: 1,
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  rowCopy: { flex: 1 },
  rowTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  rowTime: { color: palette.muted, fontSize: 13, marginTop: 4 },
  editText: { color: palette.nap, fontSize: 13, fontWeight: '700' },
  undoBanner: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 18,
    minHeight: 58,
    paddingLeft: 18,
    paddingRight: 8,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.ink,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  undoText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  undoButton: { minWidth: 70, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  undoButtonText: { color: '#C9C0F1', fontSize: 15, fontWeight: '800' },
});
