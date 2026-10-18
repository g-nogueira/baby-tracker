import nursing from '../../../../assets/napper/nursingicon.webp';
import nap from '../../../../assets/napper/napicon.webp';
import nightWaking from '../../../../assets/napper/nightwakingicon.webp';
import bedtime from '../../../../assets/napper/bedtimeicon.webp';
import wake from '../../../../assets/napper/wakeupicon.webp';
import night from '../../../../assets/napper/nightsleepicon.webp';
import diaper from '../../../../assets/napper/diapericon.webp';
import medicine from '../../../../assets/napper/medicineicon.webp';
import nightWakingPurple from '../../../../assets/napper/nightwaking.webp';
import napPurple from '../../../../assets/napper/nap.webp';

/** Literal asset imports let Metro bundle the supplied artwork offline. */
export const activityArtwork = {
  nursing,
  nap,
  'night-waking': nightWaking,
  bedtime,
  wake,
  night,
  diaper,
  medicine,
};
export const monochromeArtwork = { nap: napPurple, 'night-waking': nightWakingPurple };
