import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { buildMapHtml } from './mapHtml';
import type { MapViewProps } from './MapView';

/** Web: the Leaflet page in an iframe. See MapView.tsx for the native WebView. */
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
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const framed = useRef(false);
  // Built once: changing srcDoc would reload the map and lose the officer's pan/zoom.
  const [html] = useState(() => buildMapHtml(center, zoom, { basemap }));

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      try {
        const msg = JSON.parse(e.data) as { source?: string; id?: string };
        if (msg.source !== 'tr-map' || !msg.id) return;
        if (msg.id === '__ready') setReady(true);
        else onPinPress?.(msg.id);
      } catch {
        // not ours
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onPinPress]);

  useEffect(() => {
    if (!ready) return;
    // The first update always frames the pins; after that only when asked.
    const data = {
      pins,
      route,
      areas,
      origin,
      circle,
      dots,
      choropleth,
      fit: fit || !framed.current,
    };
    framed.current = true;
    frame.current?.contentWindow?.postMessage({ source: 'tr-host', data }, '*');
  }, [ready, pins, route, areas, origin, circle, dots, choropleth, fit]);

  return (
    <View style={[{ overflow: 'hidden' }, style]} accessibilityLabel={accessibilityLabel}>
      <iframe
        ref={frame}
        srcDoc={html}
        title="Map"
        style={{ border: 'none', width: '100%', height: '100%', display: 'block' }}
      />
    </View>
  );
}
