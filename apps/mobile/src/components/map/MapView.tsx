import React, { useEffect, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { LatLng } from '../../data/types';
import {
  buildMapHtml,
  type MapAreas,
  type MapChoropleth,
  type MapCircle,
  type MapOrigin,
  type MapPin,
  type MapRoute,
} from './mapHtml';

export type { MapAreas, MapChoropleth, MapCircle, MapOrigin, MapPin, MapRoute };

export interface MapViewProps {
  center: LatLng;
  zoom: number;
  pins: MapPin[];
  route?: MapRoute;
  /** Outline and frame these areas instead of the pins. */
  areas?: MapAreas | null;
  /** Blue "you are here" dot, with a label. */
  origin?: MapOrigin | null;
  /** Dashed search radius; framed instead of the pins when fitting. */
  circle?: MapCircle | null;
  /** Small grey dots that are not tappable. */
  dots?: LatLng[];
  /** Shaded regions; taps come back through onPinPress with the region code. */
  choropleth?: MapChoropleth | null;
  /** false: no map tiles, a plain light background. Read once, at mount. */
  basemap?: boolean;
  accessibilityLabel?: string;
  /** Frame the view around the pins on this update. */
  fit: boolean;
  onPinPress?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Native (Android/iOS): the same Leaflet page as web, in a WebView. Metro picks
 * MapView.web.tsx on web, where react-native-webview is not supported.
 */
export function MapView({
  center,
  zoom,
  pins,
  route,
  areas,
  origin,
  circle,
  dots,
  choropleth,
  basemap = true,
  accessibilityLabel,
  fit,
  onPinPress,
  style,
}: MapViewProps) {
  // `object`, not the default `undefined`: webview 14 types its props as
  // `WebViewProps & P`, and `& undefined` collapses to never.
  const ref = useRef<WebView<object>>(null);
  const [ready, setReady] = useState(false);
  const framed = useRef(false);
  // Built once: reloading the page would lose the officer's pan/zoom.
  const [html] = useState(() => buildMapHtml(center, zoom, { basemap }));

  useEffect(() => {
    if (!ready) return;
    // The first update always frames the pins; after that only when asked.
    const data = JSON.stringify({
      pins,
      route,
      areas,
      origin,
      circle,
      dots,
      fit: fit || !framed.current,
    });
    framed.current = true;
    ref.current?.injectJavaScript(`window.__update(${data}); true;`);
  }, [ready, pins, route, areas, origin, circle, dots, choropleth, fit]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { source?: string; id?: string };
      if (msg.source !== 'tr-map' || !msg.id) return;
      if (msg.id === '__ready') setReady(true);
      else onPinPress?.(msg.id);
    } catch {
      // not ours
    }
  };

  return (
    <View style={[{ overflow: 'hidden' }, style]} accessibilityLabel={accessibilityLabel}>
      <WebView<object>
        ref={ref}
        originWhitelist={['*']}
        // Without a base URL, tile requests carry no Referer and OSM blocks them.
        source={{ html, baseUrl: 'https://territoryradar.ppcbank.app/' }}
        onMessage={onMessage}
        javaScriptEnabled
        setSupportMultipleWindows={false}
        style={{ flex: 1, backgroundColor: 'transparent' }}
      />
    </View>
  );
}
