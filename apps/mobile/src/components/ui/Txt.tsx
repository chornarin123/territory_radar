import React from 'react';
import { Text, type TextProps, type TextStyle, StyleSheet } from 'react-native';
import { khmerShare } from '@territory-radar/shared';
import { font } from '../../theme/tokens';

/**
 * Text that switches to Noto Sans Khmer when its content contains Khmer script.
 * IBM Plex has no Khmer glyphs; without this the platform substitutes whatever
 * system font it has, which on cheap Android handsets is where rendering breaks.
 */
export function Txt({ style, children, ...rest }: TextProps) {
  const text =
    typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : '';
  if (text && khmerShare(text) > 0) {
    const flat = StyleSheet.flatten(style) as TextStyle | undefined;
    const bold = flat?.fontFamily === font.bold || flat?.fontFamily === font.semibold;
    return (
      <Text
        {...rest}
        // Khmer stacks consonants below the baseline; give it room.
        style={[
          style,
          {
            fontFamily: bold ? font.khmerBold : font.khmer,
            lineHeight: (flat?.fontSize ?? 14) * 1.6,
          },
        ]}
      >
        {children}
      </Text>
    );
  }
  return (
    <Text {...rest} style={style}>
      {children}
    </Text>
  );
}
