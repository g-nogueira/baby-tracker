import { createContext, useContext } from 'react';
import { StyleSheet, Text as NativeText, type TextProps } from 'react-native';
import { useActivityTheme } from './activity-theme';

/** A failed font load leaves tracking usable with the platform typeface. */
export const TrackingFontsContext = createContext(false);

export function Text({ style, ...props }: TextProps) {
  const ready = useContext(TrackingFontsContext);
  const theme = useActivityTheme();
  const textStyle = ready && theme.night ? StyleSheet.flatten(style) : undefined;
  const family =
    textStyle?.fontStyle === 'italic'
      ? 'Saans-RegularItalic'
      : textStyle?.fontWeight === 'bold' || Number(textStyle?.fontWeight) >= 500
        ? 'Saans-Medium'
        : 'Saans-Regular';
  return (
    <NativeText
      {...props}
      style={[
        style,
        ready && theme.night && { fontFamily: family, fontWeight: 'normal', fontStyle: 'normal' },
      ]}
    />
  );
}
