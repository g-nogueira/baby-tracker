import {
  type NursingDurationProjection,
  type NursingSession,
  type NursingSide,
  projectNursingDurations,
} from '@baby-tracker/domain';

export type NursingSideGuidance = 'Last' | 'Next' | null;

export interface NursingGuidanceModel {
  left: NursingSideGuidance;
  right: NursingSideGuidance;
}

export interface NursingHomeActionModel {
  kind: 'nursing';
  label: 'Nursing';
  meta: string;
  active: boolean;
}

export interface NursingControllerModel extends NursingDurationProjection {
  sessionId: string;
  status: 'active' | 'paused';
  activeSide: NursingSide | null;
}

export interface NursingHomeModel {
  action: NursingHomeActionModel;
  guidance: NursingGuidanceModel;
  controller: NursingControllerModel | null;
}

/** Derives Last/Next solely from the latest completed explicit Last value. */
export function nursingGuidance(latestCompletedLast: NursingSide | null): NursingGuidanceModel {
  if (latestCompletedLast === null) return { left: null, right: null };
  return latestCompletedLast === 'left'
    ? { left: 'Last', right: 'Next' }
    : { left: 'Next', right: 'Last' };
}

/** Projects the independent Nursing Home action and exact active-session controller. */
export function deriveNursingHomeModel(
  activeSession: NursingSession | null,
  latestCompletedLast: NursingSide | null,
  now: Date,
): NursingHomeModel {
  const guidance = nursingGuidance(latestCompletedLast);
  if (activeSession === null) {
    const nextSide = guidance.left === 'Next' ? 'Left' : guidance.right === 'Next' ? 'Right' : null;
    return {
      action: {
        kind: 'nursing',
        label: 'Nursing',
        meta: nextSide === null ? 'Start' : `Next ${nextSide}`,
        active: false,
      },
      guidance,
      controller: null,
    };
  }
  if (activeSession.status === 'completed') {
    throw new Error('A completed Nursing session cannot drive active Home controls.');
  }

  const openBoundary =
    activeSession.status === 'active'
      ? activeSession.activeSideStartedAt
      : activeSession.pauseStartedAt;
  const projectionNow =
    openBoundary !== null && now.getTime() < new Date(openBoundary).getTime()
      ? new Date(openBoundary)
      : now;
  const durations = projectNursingDurations(activeSession, projectionNow);
  return {
    action: {
      kind: 'nursing',
      label: 'Nursing',
      meta:
        activeSession.status === 'paused'
          ? 'Paused'
          : `${activeSession.activeSide === 'left' ? 'Left' : 'Right'} active`,
      active: true,
    },
    guidance,
    controller: {
      sessionId: activeSession.id,
      status: activeSession.status,
      activeSide: activeSession.activeSide,
      ...durations,
    },
  };
}

/** Keeps Nursing in Home slot three for every two-slot Sleep state. */
export function appendNursingHomeAction<T>(
  sleepActions: readonly [T, T],
  nursingAction: NursingHomeActionModel,
): readonly [T, T, NursingHomeActionModel] {
  return [sleepActions[0], sleepActions[1], nursingAction];
}
