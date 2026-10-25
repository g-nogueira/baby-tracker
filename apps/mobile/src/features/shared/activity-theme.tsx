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
  background: '#121127',
  surface: '#1B1A3D',
  raised: '#2A2951',
  field: '#232242',
  text: '#F9F8F6',
  muted: '#C4C4F3',
  border: '#403A65',
  track: '#22213F',
  accent: '#8587FF',
  accentSoft: '#332D5C',
  onAccent: '#19152F',
  error: '#F3A0A8',
};
export const ActivityThemeContext = createContext(dayTheme);
export const useActivityTheme = () => useContext(ActivityThemeContext);
