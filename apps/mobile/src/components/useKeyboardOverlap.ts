import { useEffect, useState, type RefObject } from 'react';
import { Keyboard, Platform, type ViewInstance } from 'react-native';

/**
 * How much of `ref`'s view the on-screen keyboard covers, in px. Measured on
 * screen rather than guessed from header and status-bar heights, so it is right
 * on any phone. SDK 58 Android is edge-to-edge and no longer shrinks the window
 * for the keyboard; on a phone where the window still shrinks, this returns 0
 * rather than pushing the content up twice.
 */
export function useKeyboardOverlap(ref: RefObject<ViewInstance | null>): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    // iOS announces the keyboard before it animates in; Android only after.
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      ref.current?.measureInWindow((_x, y, _w, h) => {
        setOverlap(Math.max(0, y + h - e.endCoordinates.screenY));
      });
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setOverlap(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [ref]);

  return overlap;
}
