import type { LatLng } from '../../data/types';
import { color } from '../../theme/tokens';

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  /** Short text inside the pin: a score or a stop number. */
  label: string;
  color: string;
  selected?: boolean;
  /** Orange outer ring for prospects with data-quality flags. */
  flagged?: boolean;
}

export interface MapRoute {
  start: LatLng;
  startLabel: string;
  path: LatLng[];
  /** Dashed until the order is optimized, as in the Visits prototype. */
  dashed: boolean;
}

/** Areas picked in the area filter: outlined, and framed instead of the pins. */
export interface MapAreas {
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  /** GeoJSON features; may arrive after the bbox, the polygons load lazily. */
  shapes: unknown[];
}

/** Where distances are measured from: the officer, or their branch. */
export interface MapOrigin extends LatLng {
  label: string;
}

/** Search radius around the origin, in metres: dashed, and framed when fitting. */
export interface MapCircle extends LatLng {
  radius: number;
}

/** Background of a map with no tiles: soft blue, so zooming out never shows white. */
export const NO_TILES_BG = '#cfdbec';

/** Shaded regions (Area demand). Styles are decided by the host; taps send the code. */
export interface MapChoropleth {
  /** faded: outside the scope, drawn lighter so the scope stands out. */
  shapes: { code: string; geometry: unknown; fill: string; faded: boolean }[];
  /** Regions known only as a point: a shaded circle instead of a polygon. */
  points: { code: string; lat: number; lng: number; fill: string }[];
  /** Outline drawn over the shapes, e.g. the khan in scope. */
  outline: unknown | null;
  /** Amber outline: polygon geometry, or a point. */
  selected: ({ code: string } & ({ geometry: unknown } | { lat: number; lng: number })) | null;
  /** Shown only between minZoom and maxZoom when given (Leaflet zoom levels). */
  labels: {
    lat: number;
    lng: number;
    name: string;
    score: number;
    light: boolean;
    minZoom?: number;
    maxZoom?: number;
  }[];
  /** Framed when fitting: [minLng, minLat, maxLng, maxLat]. */
  bbox: [number, number, number, number];
}

export interface MapData {
  pins: MapPin[];
  choropleth?: MapChoropleth | null;
  route?: MapRoute;
  areas?: MapAreas | null;
  origin?: MapOrigin | null;
  circle?: MapCircle | null;
  /** Small grey dots, not tappable: prospects outside the radius. */
  dots?: LatLng[];
  /** Re-frame the view around the pins. Only on first load or a filter change. */
  fit: boolean;
}

/**
 * One self-contained Leaflet page, used by both the web iframe and the native
 * WebView, so the map looks and behaves the same on both. The host pushes data
 * in with window.__update(); taps come back as { source: 'tr-map', id }.
 *
 * Tiles (no API key needed): Esri World Imagery satellite with road and place
 * labels on top by default, and OpenStreetMap's standard tiles behind the layer
 * switcher. OSM's tile policy requires a Referer, so the native WebView loads this
 * page with a baseUrl. All data shown is synthetic demo data.
 */
export function buildMapHtml(
  center: LatLng,
  zoom: number,
  /** basemap false: no tiles, a plain light background (Area demand). */
  { basemap = true }: { basemap?: boolean } = {},
): string {
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%;
    background: ${basemap ? '#E9ECE6' : NO_TILES_BG}; }
  .leaflet-container { background: ${basemap ? '#E9ECE6' : NO_TILES_BG}; }
  .rlabel { transform: translate(-50%, -50%); text-align: center; white-space: nowrap;
    pointer-events: none; line-height: 1.1; }
  /* A soft halo keeps labels readable over satellite imagery too. */
  .rlabel.light { text-shadow: 0 0 2px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.6); }
  .rlabel.dark { text-shadow: 0 0 2px #FFFFFF, 0 0 4px rgba(255,255,255,0.8); }
  .rlabel b { display: block; font: 600 9px system-ui, sans-serif; }
  .rlabel span { display: block; font: 600 11px 'IBM Plex Mono', ui-monospace, monospace; }
  .pin {
    width: 34px; height: 34px; border-radius: 17px; box-sizing: border-box;
    border: 2px solid #FFFFFF; color: #FFFFFF;
    font: 600 11px 'IBM Plex Mono', ui-monospace, monospace;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.25); cursor: pointer;
  }
  .pin.flagged { box-shadow: 0 0 0 2px ${color.warnDot}, 0 1px 3px rgba(0,0,0,0.25); }
  .pin.selected { border-color: ${color.selectedRing}; border-width: 3px; transform: scale(1.25); }
  .start {
    padding: 4px 6px; border-radius: 8px; background: ${color.selectedRing}; color: #2B1606;
    font: 700 10px system-ui, sans-serif; white-space: nowrap; transform: translate(-50%, -50%);
    display: inline-block;
  }
  .me { position: relative; width: 0; height: 0; }
  .me .halo { position: absolute; left: -16px; top: -16px; width: 32px; height: 32px;
    border-radius: 16px; background: rgba(59,130,246,0.25); }
  .me .dot { position: absolute; left: -8px; top: -8px; width: 16px; height: 16px; box-sizing: border-box;
    border-radius: 8px; background: #2563EB; border: 3px solid #FFFFFF; box-shadow: 0 1px 3px rgba(0,0,0,0.35); }
  .me .lbl { position: absolute; top: 12px; left: 0; transform: translateX(-50%); white-space: nowrap;
    padding: 1px 6px; border-radius: 8px; background: #FFFFFF; color: #12305A;
    font: 700 10px system-ui, sans-serif; box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
  .leaflet-control-attribution { font-size: 9px; max-width: 200px; white-space: normal; }
  .credit-btn { position: relative; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 13px;
    background: rgba(255,255,255,0.9); color: #12305A; font: 700 13px Georgia, serif;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3); cursor: pointer; }
  /* A 44px touch target around the small button. */
  .credit-btn::after { content: ''; position: absolute; inset: -9px; }
</style>
</head><body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: true, attributionControl: true })
    .setView([${center.lat}, ${center.lng}], ${zoom});
  if (${basemap}) {
    var esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    var tile = '/MapServer/tile/{z}/{y}/{x}';
    var satellite = L.layerGroup([
      L.tileLayer(esri + 'World_Imagery' + tile, {
        maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics'
      }),
      L.tileLayer(esri + 'Reference/World_Transportation' + tile, { maxZoom: 19 }),
      L.tileLayer(esri + 'Reference/World_Boundaries_and_Places' + tile, { maxZoom: 19 })
    ]).addTo(map);
    var street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    // Top-left under the zoom buttons: the Radar legend covers the top-right corner.
    L.control.layers({ 'Satellite': satellite, 'Map': street }, null, { position: 'topleft' }).addTo(map);
  } else {
    // The host puts its own pill top-left.
    map.zoomControl.setPosition('topright');
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Boundaries &copy; geoBoundaries / ODC, CC BY 4.0');
    // "Demand map" (plain background) or "Satellite" under see-through shading.
    // No place-name tiles here: the sangkat labels already name every area.
    var esriImg = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    var plain = L.layerGroup().addTo(map);
    var imagery = L.layerGroup([
      L.tileLayer(esriImg + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics'
      }),
      L.tileLayer(esriImg + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
    ]);
    L.control.layers({ 'Demand map': plain, 'Satellite': imagery }, null, { position: 'topright' }).addTo(map);
    map.on('baselayerchange', function (e) {
      onImagery = e.layer === imagery;
      if (lastChoropleth) {
        regionLayer.clearLayers();
        drawChoropleth(lastChoropleth);
      }
    });
  }
  // Map credits stay reachable, as the data licences require, but off the map
  // until asked for. Top corner: Radar's bottom card covers the bottom ones.
  var creditCorner = ${basemap} ? 'topleft' : 'topright';
  map.attributionControl.setPosition(creditCorner);
  var credits = map.attributionControl.getContainer();
  credits.style.display = 'none';
  var creditControl = L.control({ position: creditCorner });
  creditControl.onAdd = function () {
    var b = L.DomUtil.create('button', 'credit-btn');
    b.type = 'button';
    b.textContent = 'i';
    b.setAttribute('aria-label', 'Map credits');
    L.DomEvent.disableClickPropagation(b);
    L.DomEvent.on(b, 'click', function () {
      credits.style.display = credits.style.display === 'none' ? '' : 'none';
    });
    return b;
  };
  creditControl.addTo(map);

  // Shading is see-through over satellite imagery, solid on the plain map.
  var onImagery = false;
  var lastChoropleth = null;

  // Area demand: shaded regions, then outline, selection and labels on top.
  var regionLayer = L.layerGroup().addTo(map);

  // Under the pins: outlines of the areas picked in the area filter.
  var areaLayer = L.geoJSON(null, {
    interactive: false,
    // Red reads clearly over both satellite imagery and the street map.
    style: { color: '#E5252A', weight: 3, opacity: 1, fillColor: '#E5252A', fillOpacity: 0.1 }
  }).addTo(map);
  var layer = L.layerGroup().addTo(map);

  function send(id) {
    var msg = JSON.stringify({ source: 'tr-map', id: id });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    else if (window.parent) window.parent.postMessage(msg, '*');
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function drawChoropleth(c) {
    lastChoropleth = c;
    // Plain map: every area shaded; borders faint white, without white gaps.
    // Satellite: only the selected sangkat is shaded. The rest is bare imagery
    // with an outline and its label (fill kept at 0 so it can still be tapped).
    var selCode = c.selected ? c.selected.code : null;
    var styleFor = function (s) {
      if (onImagery) {
        if (s.code === selCode) {
          return { color: '#FFFFFF', weight: 1.2, opacity: 0.9, fillColor: s.fill, fillOpacity: 0.55 };
        }
        return s.faded
          ? { color: '#FFFFFF', weight: 0.7, opacity: 0.35, fillColor: s.fill, fillOpacity: 0 }
          : { color: '#FFFFFF', weight: 1, opacity: 0.7, fillColor: s.fill, fillOpacity: 0 };
      }
      return s.faded
        ? { color: '#FFFFFF', weight: 0.6, opacity: 0.3, fillColor: s.fill, fillOpacity: 0.6 }
        : { color: '#FFFFFF', weight: 0.8, opacity: 0.55, fillColor: s.fill, fillOpacity: 1 };
    };
    c.shapes.forEach(function (s) {
      L.geoJSON({ type: 'Feature', properties: {}, geometry: s.geometry }, {
        style: styleFor(s)
      }).on('click', function () { send(s.code); }).addTo(regionLayer);
    });
    c.points.forEach(function (p) {
      var lit = !onImagery || p.code === selCode;
      L.circleMarker([p.lat, p.lng], {
        radius: 9, color: '#FFFFFF', weight: 1.5, fillColor: p.fill, fillOpacity: lit ? 1 : 0
      }).on('click', function () { send(p.code); }).addTo(regionLayer);
    });
    if (c.outline) {
      L.geoJSON({ type: 'Feature', properties: {}, geometry: c.outline }, {
        interactive: false, style: { color: '${color.navy}', weight: 2.5, fill: false }
      }).addTo(regionLayer);
    }
    if (c.selected && c.selected.geometry) {
      L.geoJSON({ type: 'Feature', properties: {}, geometry: c.selected.geometry }, {
        interactive: false, style: { color: '#f59e0b', weight: 3, fill: false }
      }).addTo(regionLayer);
    } else if (c.selected) {
      L.circleMarker([c.selected.lat, c.selected.lng], {
        interactive: false, radius: 11, color: '#f59e0b', weight: 3, fill: false
      }).addTo(regionLayer);
    }
    regionLabels = c.labels.map(function (l) {
      var ink = l.light ? '#FFFFFF' : '${color.navy}';
      return {
        min: l.minZoom == null ? -1 : l.minZoom,
        max: l.maxZoom == null ? 99 : l.maxZoom,
        marker: L.marker([l.lat, l.lng], {
          interactive: false, keyboard: false,
          icon: L.divIcon({ className: '', iconSize: [0, 0],
            html: '<div class="rlabel ' + (l.light ? 'light' : 'dark') + '" style="color:' + ink + '"><b>' + esc(l.name) + '</b><span>' +
              esc(l.score) + '</span></div>' })
        })
      };
    });
    showLabelsForZoom();
  }

  // Labels can be limited to a zoom range: khan names zoomed out, sangkats in.
  var labelLayer = L.layerGroup().addTo(map);
  var regionLabels = [];
  function showLabelsForZoom() {
    var z = map.getZoom();
    labelLayer.clearLayers();
    regionLabels.forEach(function (l) {
      if (z >= l.min && z <= l.max) l.marker.addTo(labelLayer);
    });
  }
  map.on('zoomend', showLabelsForZoom);

  window.__update = function (data) {
    layer.clearLayers();
    areaLayer.clearLayers();
    regionLayer.clearLayers();
    regionLabels = [];
    labelLayer.clearLayers();
    lastChoropleth = null;
    if (data.choropleth) drawChoropleth(data.choropleth);
    if (data.areas && data.areas.shapes.length) areaLayer.addData(data.areas.shapes);
    var bounds = [];
    var circle = null;

    if (data.circle) {
      circle = L.circle([data.circle.lat, data.circle.lng], {
        radius: data.circle.radius, interactive: false,
        color: '#60A5FA', weight: 2, dashArray: '6 6', fillColor: '#3B82F6', fillOpacity: 0.10
      }).addTo(layer);
    }

    (data.dots || []).forEach(function (d) {
      L.circleMarker([d.lat, d.lng], {
        radius: 4, interactive: false, color: '#FFFFFF', weight: 1.5, fillColor: '#7B8799', fillOpacity: 1
      }).addTo(layer);
    });

    if (data.route) {
      var line = [[data.route.start.lat, data.route.start.lng]].concat(
        data.route.path.map(function (p) { return [p.lat, p.lng]; }));
      // White casing keeps the navy route readable over satellite imagery.
      L.polyline(line, { color: '#FFFFFF', weight: 6, opacity: 0.9 }).addTo(layer);
      L.polyline(line, { color: '${color.navy}', weight: 3, opacity: 0.9,
        dashArray: data.route.dashed ? '7 6' : null }).addTo(layer);
      if (data.route.startLabel) {
        L.marker([data.route.start.lat, data.route.start.lng], {
          icon: L.divIcon({ className: '', html: '<span class="start">' + esc(data.route.startLabel) + '</span>',
            iconSize: [0, 0] }),
          interactive: false
        }).addTo(layer);
      }
      bounds.push([data.route.start.lat, data.route.start.lng]);
    }

    if (data.origin) {
      L.marker([data.origin.lat, data.origin.lng], {
        icon: L.divIcon({ className: '', iconSize: [0, 0],
          html: '<div class="me"><span class="halo"></span><span class="dot"></span>' +
            '<span class="lbl">' + esc(data.origin.label) + '</span></div>' }),
        interactive: false, zIndexOffset: 2000
      }).addTo(layer);
      bounds.push([data.origin.lat, data.origin.lng]);
    }

    data.pins.forEach(function (p) {
      var cls = 'pin' + (p.selected ? ' selected' : '') + (p.flagged ? ' flagged' : '');
      var m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
          html: '<div class="' + cls + '" style="background:' + p.color + '">' + esc(p.label) + '</div>' }),
        zIndexOffset: p.selected ? 1000 : 0,
        keyboard: true,
        title: p.label
      }).addTo(layer);
      m.on('click', function () { send(p.id); });
      bounds.push([p.lat, p.lng]);
    });

    if (data.fit && data.choropleth) {
      var cb = data.choropleth.bbox;
      map.fitBounds([[cb[1], cb[0]], [cb[3], cb[2]]], { padding: [14, 14] });
    } else if (data.fit && circle) {
      map.fitBounds(circle.getBounds(), { padding: [12, 12] });
    } else if (data.fit && data.areas) {
      var b = data.areas.bbox;
      map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [24, 24], maxZoom: 17 });
    } else if (data.fit && bounds.length) {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
    }
  };

  // Web host: data arrives by postMessage.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return; } }
    if (d && d.source === 'tr-host') window.__update(d.data);
  });
  send('__ready');
</script>
</body></html>`;
}
