import { createContext, useContext } from 'react';

/** Presentation tokens only; sleep state and provider selection never depend on appearance. */
export const dayTheme = {
  night: false,
  background: '#F8F5F0',
  surface: '#FFFFFF',
  raised: '#EDE9E3',
  field: '#F2EEE8',
  text: '#343331',
  muted: '#817C76',
  border: '#E5DED5',
  track: '#E9E3DA',
  accent: '#796BC4',
  accentSoft: '#ECE6FA',
  onAccent: '#FFFFFF',
  error: '#A7464D',
};
export type ActivityTheme = typeof dayTheme;
export const nightTheme: ActivityTheme = {
  night: true,
  background: '#16142E',
  surface: '#211E40',
  raised: '#2D2952',
  field: '#2A264A',
  text: '#F6F3FF',
  muted: '#BAB3DB',
  border: '#403A65',
  track: '#252141',
  accent: '#A49AFF',
  accentSoft: '#332D5C',
  onAccent: '#19152F',
  error: '#F3A0A8',
};
export const ActivityThemeContext = createContext(dayTheme);
export const useActivityTheme = () => useContext(ActivityThemeContext);
