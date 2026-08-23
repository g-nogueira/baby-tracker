import type { SleepSession } from '@baby-tracker/domain';

export type SleepHomeState = 'awake' | 'nap-active' | 'night-asleep' | 'night-awake';

export type SleepHomeActionKind =
  | 'start-night-sleep'
  | 'start-nap'
  | 'open-current-nap'
  | 'end-night-sleep'
  | 'start-night-waking'
  | 'resume-night-sleep';

export interface SleepHomeActionModel {
  kind: SleepHomeActionKind;
  label: string;
  disabledReason: string | null;
}

export type SleepHomeControllerModel =
  | {
      kind: 'nap';
      durationStartedAt: string;
      primaryAction: 'stop-nap';
    }
  | {
      kind: 'night-asleep';
      durationStartedAt: string;
      primaryAction: 'end-night-sleep';
    }
  | {
      kind: 'night-awake';
      durationStartedAt: string;
      primaryAction: 'resume-night-sleep';
    };

export interface SleepHomeModel {
  state: SleepHomeState;
  actions: readonly [SleepHomeActionModel, SleepHomeActionModel];
  center: {
    label: string;
    durationStartedAt: string | null;
    hint: string;
  };
  controller: SleepHomeControllerModel | null;
}

/** Projects canonical Sleep state into the two Home actions, centre copy, and live controller. */
export function deriveSleepHomeModel(
  activeSleep: SleepSession | null,
  latestCompletedEnd: string | null,
): SleepHomeModel {
  if (activeSleep === null) {
    return {
      state: 'awake',
      actions: [action('start-night-sleep', 'Night sleep'), action('start-nap', 'Nap')],
      center: {
        label: latestCompletedEnd === null ? 'Awake' : 'Awake for',
        durationStartedAt: latestCompletedEnd,
        hint: latestCompletedEnd === null ? 'No sleep logged yet' : 'Since the last sleep ended',
      },
      controller: null,
    };
  }

  if (activeSleep.kind === 'nap') {
    return {
      state: 'nap-active',
      actions: [
        action(
          'start-night-sleep',
          'Night sleep',
          'A nap is active. Stop it before starting Night sleep.',
        ),
        action('open-current-nap', 'Current Nap'),
      ],
      center: {
        label: 'Asleep for',
        durationStartedAt: activeSleep.startedAt,
        hint: 'Nap active',
      },
      controller: {
        kind: 'nap',
        durationStartedAt: activeSleep.startedAt,
        primaryAction: 'stop-nap',
      },
    };
  }

  const openPhase = activeSleep.phases.at(-1);
  if (openPhase === undefined || openPhase.endedAt !== null) {
    throw new Error('An active Night session requires a final open phase.');
  }

  if (openPhase.kind === 'asleep') {
    return {
      state: 'night-asleep',
      actions: [action('end-night-sleep', 'Wake up'), action('start-night-waking', 'Night waking')],
      center: {
        label: 'Asleep for',
        durationStartedAt: openPhase.startedAt,
        hint: 'Night sleep active',
      },
      controller: {
        kind: 'night-asleep',
        durationStartedAt: activeSleep.startedAt,
        primaryAction: 'end-night-sleep',
      },
    };
  }

  return {
    state: 'night-awake',
    actions: [
      action('end-night-sleep', 'Wake up'),
      action('resume-night-sleep', 'Fell asleep again'),
    ],
    center: {
      label: 'Awake tonight',
      durationStartedAt: openPhase.startedAt,
      hint: 'Night waking active',
    },
    controller: {
      kind: 'night-awake',
      durationStartedAt: openPhase.startedAt,
      primaryAction: 'resume-night-sleep',
    },
  };
}

function action(
  kind: SleepHomeActionKind,
  label: string,
  disabledReason: string | null = null,
): SleepHomeActionModel {
  return { kind, label, disabledReason };
}
