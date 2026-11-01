import { useFonts } from 'expo-font';
// Per-weight imports: only these seven files are bundled, not every weight of each family.
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans/700Bold';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
import { NotoSansKhmer_400Regular } from '@expo-google-fonts/noto-sans-khmer/400Regular';
import { NotoSansKhmer_700Bold } from '@expo-google-fonts/noto-sans-khmer/700Bold';

/** Keys must match `font` in tokens.ts. Returns [loaded, error]. */
export function useAppFonts() {
  return useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
    IBMPlexMono_600SemiBold,
    NotoSansKhmer_400Regular,
    NotoSansKhmer_700Bold,
  });
}
