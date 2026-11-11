import { getZonesAQI, getSensorInfoList } from './api.js';
import {
  getAQIColor,
  getCurrentTheme,
  getAQIStandard,
  formatPollutantName,
  aqiTextColor,
  getAQICategory,
  showSnackbar,
} from './utils.js';
import { Zone, AQIData, SensorInfo, AQIHistory } from './types.js';
import { showNodeSheet } from './sensors.js';
import { STORAGE_KEY_PINS } from './config.js';
import { setPinIcon } from './ui.js';
import * as Leaflet from 'leaflet';

declare const L: typeof Leaflet;

// declare global Leaflet variable
let mapInstance: Leaflet.Map | null = null;
let mapTileLayer: Leaflet.TileLayer | null = null;
let currentMapZoneId: string | null = null;

export function getCurrentMapZoneId() {
  return currentMapZoneId;
}

export function initMap(allZones: Zone[]): void {
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
    markersLayer = null;
  }
  stopPlayback();
  playbackIndex = null;

  // Define bounds for J&K region
  const bounds: Leaflet.LatLngBoundsExpression = [
    [31.5, 73.5],
    [37.0, 80.5],
  ];

  mapInstance = L.map('map-container', {
    zoomControl: false,
    minZoom: 6,
    maxZoom: 15,
    maxBounds: bounds,
    maxBoundsViscosity: 0.8,
  }).setView([33.9, 75.5], 7);

  const located = allZones.filter((zone) => zone.lat && zone.lon);
  regionBounds =
    located.length > 0 ? L.latLngBounds(located.map((zone) => L.latLng(zone.lat, zone.lon))) : null;
  userMovedMap = false;
  fitToRegion();
  mapInstance.on('dragstart', () => {
    userMovedMap = true;
  });
  mapInstance.on('zoomstart', () => {
    if (!fittingMap) {
      userMovedMap = true;
    }
  });

  updateMapTiles(getCurrentTheme());
  populateMapMarkers(allZones);
  renderMapLegend();
}

function renderMapLegend() {
  const legend = document.getElementById('map-legend');
  if (!legend) {
    return;
  }
  const std = getAQIStandard();
  const samples = std === 'us' ? [25, 75, 125, 175, 250, 400] : [25, 75, 150, 250, 350, 450];
  const ticks = std === 'us' ? [0, 50, 100, 150, 200, 300, '300+'] : [0, 50, 100, 200, 300, 400, '400+'];
  legend.innerHTML = `
    <div class="map-legend-title">${std === 'us' ? 'US AQI' : 'NAQI'}</div>
    <div class="map-legend-bar">
      ${samples
        .map((v) => `<span style="background: ${getAQIColor(v, std).hex};" title="${getAQICategory(v, std)}"></span>`)
        .join('')}
    </div>
    <div class="map-legend-ticks">${ticks.map((t) => `<span>${t}</span>`).join('')}</div>
    <div class="map-legend-ends"><span>Good</span><span>${std === 'us' ? 'Hazardous' : 'Severe'}</span></div>
  `;
}

let youMarker: Leaflet.Marker | null = null;

function locateOnMap() {
  const button = document.getElementById('map-locate');
  if (!navigator.geolocation || !mapInstance) {
    showSnackbar("This browser can't share its location");
    return;
  }
  button?.classList.add('busy');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      button?.classList.remove('busy');
      if (!mapInstance) {
        return;
      }
      const here = L.latLng(position.coords.latitude, position.coords.longitude);
      youMarker?.remove();
      youMarker = L.marker(here, {
        icon: L.divIcon({ html: '<div class="map-you"></div>', className: '', iconSize: [16, 16] }),
        interactive: false,
        zIndexOffset: -100,
      }).addTo(mapInstance);
      userMovedMap = true;
      mapInstance.flyTo(here, Math.max(mapInstance.getZoom(), 10), { duration: 0.8 });
    },
    () => {
      button?.classList.remove('busy');
      showSnackbar("Couldn't get your location");
    },
    { maximumAge: 600000, timeout: 10000 }
  );
}

(window as any).locateOnMap = locateOnMap;

let regionBounds: Leaflet.LatLngBounds | null = null;
let userMovedMap = false;
let fittingMap = false;

function fitToRegion() {
  if (!mapInstance || !regionBounds) {
    return;
  }
  fittingMap = true;
  const bottom = window.innerWidth < 768 ? 250 : 150;
  mapInstance.fitBounds(regionBounds, {
    paddingTopLeft: [32, 80],
    paddingBottomRight: [32, bottom],
    animate: false,
  });
  fittingMap = false;
}

window.addEventListener('resize', () => {
  if (!mapInstance) {
    return;
  }
  mapInstance.invalidateSize();
  if (!userMovedMap) {
    fitToRegion();
  }
});

export function updateMapTiles(theme: string): void {
  if (!mapInstance) return;
  if (mapTileLayer) mapTileLayer.remove();

  // lyrs=m (standard roadmap), gl=in (region: india)
  let url = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&gl=in';

  mapTileLayer = L.tileLayer(url, {
    attribution: '&copy; Google Maps',
    maxZoom: 20,
    className: theme === 'dark' ? 'dark-map-tiles' : '',
  }).addTo(mapInstance);
}

export function resizeMap(): void {
  if (!mapInstance) return;
  setTimeout(() => {
    mapInstance?.invalidateSize();
    if (!userMovedMap) {
      fitToRegion();
    }
  }, 100);
}

type MapLayerName = 'sensors' | 'districts';

// one bubble on the map, either a whole zone or a single sensor
interface MapBubble {
  latLng: Leaflet.LatLng;
  aqi: number | null;
  isLive: boolean;
  // modelled zones get a dashed ring when they sit among real sensors
  isModelled: boolean;
  count: number;
  onClick: () => void;
}

let markersLayer: Leaflet.LayerGroup | null = null;
let playbackHours: number[] = [];
let playbackIndex: number | null = null;
let playbackTimer = 0;

function atPlayback(history: AQIHistory[] | undefined, live: number | null): number | null {
  if (playbackIndex === null || playbackIndex >= playbackHours.length) {
    return live;
  }
  if (!history || history.length === 0) {
    return null;
  }
  const target = playbackHours[playbackIndex];
  let best: AQIHistory | null = null;
  history.forEach((entry) => {
    if (Math.abs(entry.ts - target) > 2400) {
      return;
    }
    if (!best || Math.abs(entry.ts - target) < Math.abs(best.ts - target)) {
      best = entry;
    }
  });
  if (!best) {
    return null;
  }
  const found: AQIHistory = best;
  return displayAqiOf(found.us_aqi, found.aqi);
}

function buildPlaybackHours() {
  const hours = new Set<number>();
  loadedZones.forEach(({ data }) => {
    (data?.history || []).forEach((entry) => {
      hours.add(Math.round(entry.ts / 3600) * 3600);
    });
  });
  const now = Date.now() / 1000;
  playbackHours = Array.from(hours)
    .filter((ts) => ts > now - 25 * 3600 && ts <= now)
    .sort((a, b) => a - b)
    .slice(-24);

  const slider = document.getElementById('map-time') as HTMLInputElement | null;
  const box = document.getElementById('map-playback');
  if (slider) {
    slider.max = String(playbackHours.length);
    slider.value = String(playbackHours.length);
  }
  box?.classList.toggle('hidden', playbackHours.length < 2);
  setPlaybackIndex(null);
}

function setPlaybackIndex(index: number | null) {
  playbackIndex = index !== null && index >= playbackHours.length ? null : index;
  const slider = document.getElementById('map-time') as HTMLInputElement | null;
  const label = document.getElementById('map-time-label');
  if (slider) {
    slider.value = String(playbackIndex === null ? playbackHours.length : playbackIndex);
    const percent = (Number(slider.value) / Math.max(Number(slider.max), 1)) * 100;
    slider.style.setProperty('--fill', `${percent}%`);
  }
  if (label) {
    if (playbackIndex === null) {
      label.textContent = 'Now';
    } else {
      const ts = playbackHours[playbackIndex];
      const d = new Date(ts * 1000);
      const hh = d.getHours() < 10 ? `0${d.getHours()}` : `${d.getHours()}`;
      const ago = Math.max(1, Math.round((Date.now() / 1000 - ts) / 3600));
      label.textContent = `${hh}:00 · ${ago}h ago`;
    }
  }
  document.getElementById('map-playback')?.classList.toggle('past', playbackIndex !== null);
  renderMapMarkers();
}

function stopPlayback() {
  window.clearInterval(playbackTimer);
  playbackTimer = 0;
  document.getElementById('map-play')?.classList.remove('playing');
  document.getElementById('map-play')?.setAttribute('aria-label', 'Play last 24 hours');
}

function toggleMapPlayback() {
  if (playbackTimer) {
    stopPlayback();
    return;
  }
  if (playbackHours.length < 2) {
    return;
  }
  if (playbackIndex === null) {
    setPlaybackIndex(0);
  }
  const button = document.getElementById('map-play');
  button?.classList.add('playing');
  button?.setAttribute('aria-label', 'Pause');
  playbackTimer = window.setInterval(() => {
    const next = (playbackIndex ?? 0) + 1;
    setPlaybackIndex(next);
    if (playbackIndex === null) {
      stopPlayback();
    }
  }, 450);
}

function scrubMap(value: string) {
  stopPlayback();
  setPlaybackIndex(Number(value));
}

(window as any).toggleMapPlayback = toggleMapPlayback;
(window as any).scrubMap = scrubMap;
let mapLayer: MapLayerName = 'sensors';
let loadedZones: { zone: Zone; data: AQIData | null }[] = [];
let loadedSensors: SensorInfo[] = [];

async function populateMapMarkers(allZones: Zone[]) {
  if (!mapInstance) return;

  markersLayer = L.layerGroup().addTo(mapInstance);
  mapInstance.on('zoomend', renderMapMarkers);

  const [zoneData, sensors] = await Promise.all([
    getZonesAQI(allZones.map((zone) => zone.id)).then((byId) =>
      allZones.map((zone) => ({ zone, data: byId[zone.id] ?? null }))
    ),
    getSensorInfoList(),
  ]);
  loadedZones = zoneData;
  loadedSensors = sensors || [];
  buildPlaybackHours();
}

function displayAqiOf(us: number | null | undefined, naqi: number | null | undefined) {
  if (getAQIStandard() === 'us') {
    return us ?? naqi ?? null;
  }
  return naqi ?? null;
}

function hasLiveNode(data: AQIData): boolean {
  const nodes = data.nodes;
  if (!nodes) {
    return false;
  }
  return Object.keys(nodes).some(
    (name) => nodes[name].pm2_5 !== null && nodes[name].pm2_5 !== undefined
  );
}

// in the sensor layer a zone with live sensors is replaced by them, zones that
// only have modelled data keep their one bubble
function collectBubbles(): MapBubble[] {
  const bubbles: MapBubble[] = [];
  const zonesWithSensors = new Set<string>();

  if (mapLayer === 'sensors') {
    loadedZones.forEach(({ zone, data }) => {
      if (!data || !data.nodes || !hasLiveNode(data)) return;
      const nodes = data.nodes;
      Object.keys(nodes).forEach((name) => {
        const node = nodes[name];
        // names only have to be unique inside a zone, so match the zone name too
        const info = loadedSensors.find((s) => s.name === name && s.zone === data.zone_name);
        if (!info || info.latitude == null || info.longitude == null) return;
        zonesWithSensors.add(zone.id);
        const isOffline = node.pm2_5 === null || node.pm2_5 === undefined;
        bubbles.push({
          latLng: L.latLng(info.latitude, info.longitude),
          aqi: atPlayback(node.history, isOffline ? null : displayAqiOf(node.us_aqi, node.aqi)),
          isLive: true,
          isModelled: false,
          count: 1,
          onClick: () =>
            showNodeSheet(name, node, data.zone_name, () =>
              openMapDetailSheet(zone.id, zone, data)
            ),
        });
      });
    });
  }

  loadedZones.forEach(({ zone, data }) => {
    if (!zone.lat || !zone.lon || !data || zonesWithSensors.has(zone.id)) return;
    const isLive = zone.provider === 'airgradient' && hasLiveNode(data);
    bubbles.push({
      latLng: L.latLng(zone.lat, zone.lon),
      aqi: atPlayback(data.history, displayAqiOf(data.us_aqi, data.aqi)),
      isLive,
      isModelled: mapLayer === 'sensors' && !isLive,
      count: 1,
      onClick: () => openMapDetailSheet(zone.id, zone, data),
    });
  });

  return bubbles;
}

// zoomed out, a dozen Srinagar and Jammu sensors land in the same few pixels
// and turn into a pile of half hidden numbers. walking from the worst reading
// down, each bubble joins the first group whose seed is closer than
// minDistance on screen, or starts its own. a group shows its worst reading
// with a count badge and zooms in to split up when tapped
function clusterBubbles(bubbles: MapBubble[], minDistance = 32): MapBubble[] {
  if (!mapInstance) return bubbles;
  const map = mapInstance;
  const zoom = map.getZoom();

  const seeds: Leaflet.Point[] = [];
  const groups: MapBubble[][] = [];
  [...bubbles]
    .sort((a, b) => (b.aqi ?? -1) - (a.aqi ?? -1))
    .forEach((bubble) => {
      const p = map.project(bubble.latLng, zoom);
      const index = seeds.findIndex((seed) => seed.distanceTo(p) < minDistance);
      if (index >= 0) {
        groups[index].push(bubble);
      } else {
        seeds.push(p);
        groups.push([bubble]);
      }
    });

  return groups.map((members) => {
    if (members.length === 1) {
      return members[0];
    }
    const bounds = L.latLngBounds(members.map((m) => m.latLng));
    const aqis = members.map((m) => m.aqi).filter((a): a is number => a !== null);
    return {
      latLng: bounds.getCenter(),
      aqi: aqis.length > 0 ? Math.max(...aqis) : null,
      isLive: members.some((m) => m.isLive),
      isModelled: members.every((m) => m.isModelled),
      count: members.length,
      onClick: () => map.fitBounds(bounds, { padding: [80, 80], maxZoom: map.getMaxZoom() }),
    };
  });
}

function renderMapMarkers() {
  if (!mapInstance || !markersLayer) return;
  markersLayer.clearLayers();

  const std = getAQIStandard();
  const bubbles = clusterBubbles(collectBubbles());

  // later markers sit on top, so the worst air wins wherever bubbles still touch
  bubbles
    .sort((a, b) => (a.aqi ?? -1) - (b.aqi ?? -1))
    .forEach((bubble) => {
      const fill = bubble.aqi !== null ? getAQIColor(bubble.aqi, std).hex : '#9e9e9e';
      const text = bubble.aqi !== null ? aqiTextColor(bubble.aqi, std) : '#000';
      const size = bubble.count > 1 ? 28 : 24;
      const liveBadge = bubble.isLive ? '<div class="live-badge"></div>' : '';
      const countBadge =
        bubble.count > 1 ? `<div class="map-count-badge">${bubble.count}</div>` : '';
      const markerHtml = `
            <div style="position: relative;">
              <div class="map-bubble${bubble.isModelled ? ' modelled' : ''}" style="
                  background-color: ${fill};
                  width: ${size}px; height: ${size}px;
                  color: ${text};
              ">${bubble.aqi ?? ''}</div>
              ${liveBadge}
              ${countBadge}
            </div>
        `;

      const icon = L.divIcon({
        html: markerHtml,
        className: 'custom-pin',
        iconSize: [size + 6, size + 6],
        iconAnchor: [(size + 6) / 2, (size + 6) / 2],
      });

      L.marker(bubble.latLng, { icon: icon }).addTo(markersLayer!).on('click', bubble.onClick);
    });
}

function setMapLayer(layer: MapLayerName) {
  mapLayer = layer;
  document.getElementById('map-layer-sensors')?.classList.toggle('active', layer === 'sensors');
  document.getElementById('map-layer-districts')?.classList.toggle('active', layer === 'districts');
  renderMapMarkers();
}

(window as any).setMapLayer = setMapLayer;

export function openMapDetailSheet(zoneId: string, zone: Zone, data: AQIData) {
  currentMapZoneId = zoneId;
  const sheet = document.getElementById('map-detail-sheet');
  if (!sheet) return;

  populateMapDetailSheet(zone, data);

  sheet.classList.remove('closing');
  sheet.classList.remove('hidden');

  void sheet.offsetWidth;
}

function populateMapDetailSheet(zone: Zone, data: AQIData) {
  const std = getAQIStandard();
  const displayAqi = std === 'us' ? data.us_aqi || 0 : data.aqi;
  const colors = getAQIColor(displayAqi, std);

  const pinBtn = document.getElementById('map-sheet-pin-btn');
  const pinIcon = document.getElementById('map-sheet-pin-icon');
  const pinText = document.getElementById('map-sheet-pin-text');

  if (pinBtn && pinIcon && pinText) {
    const pinnedZoneIds: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY_PINS) || '[]');
    const isPinned = pinnedZoneIds.includes(zone.id);
    setPinIcon(pinIcon, isPinned, true);

    if (isPinned) {
      pinBtn.classList.add('pinned');
      pinText.textContent = 'Pinned';
      pinBtn.style.color = 'var(--primary)';
      pinBtn.style.borderColor = 'var(--primary)';
    } else {
      pinBtn.classList.remove('pinned');
      pinText.textContent = 'Pin to Home';
      pinBtn.style.color = 'var(--on-surface-variant)';
      pinBtn.style.borderColor = 'var(--outline)';
    }
  }

  const nameEl = document.getElementById('map-sheet-zone-name');
  if (nameEl) nameEl.textContent = zone.name;

  const sourceEl = document.getElementById('map-sheet-source');
  if (sourceEl) {
    const provider = zone.provider || 'openmeteo';
    if (provider === 'airgradient') {
      sourceEl.innerHTML = '<span class="live-dot"></span>Live Ground Sensors';
    } else {
      sourceEl.textContent = 'Satellite & Model Data';
    }
  }

  const aqiValueEl = document.getElementById('map-sheet-aqi-value');
  if (aqiValueEl) {
    aqiValueEl.textContent = displayAqi.toString();
    aqiValueEl.style.color = colors.hex;
  }

  const aqiBadgeEl = document.getElementById('map-sheet-aqi-badge');
  if (aqiBadgeEl) {
    aqiBadgeEl.textContent = std === 'us' ? 'US AQI' : 'NAQI';
    aqiBadgeEl.style.background = colors.hex;
    aqiBadgeEl.style.color = aqiTextColor(displayAqi, std);
  }

  const cardEl = document.getElementById('map-sheet-aqi-card');
  if (cardEl) {
    cardEl.style.background = 'transparent';
    cardEl.style.border = 'none';
  }

  const primaryEl = document.getElementById('map-sheet-primary');
  if (primaryEl) primaryEl.innerHTML = formatPollutantName(data.main_pollutant);

  // Calculate and set trend
  const trendEl = document.getElementById('map-sheet-trend');
  const trendTextEl = document.getElementById('map-sheet-trend-text');
  if (trendEl && trendTextEl && data.history && data.history.length > 0) {
    const oneHourAgo = data.timestamp_unix - 3600;
    const validHistory = data.history.filter((h) => Math.abs(h.ts - oneHourAgo) < 1800);

    if (validHistory.length > 0) {
      validHistory.sort((a, b) => Math.abs(a.ts - oneHourAgo) - Math.abs(b.ts - oneHourAgo));
      const pastEntry = validHistory[0];
      const pastVal = std === 'us' ? pastEntry.us_aqi || 0 : pastEntry.aqi;
      const diff = displayAqi - pastVal;

      if (diff === 0) {
        trendTextEl.textContent = '-- /hr';
        trendEl.style.color = 'var(--on-surface-variant)';
      } else {
        const isRising = diff > 0;
        const sign = isRising ? '+' : '';
        trendTextEl.textContent = `${sign}${diff} /hr`;
        trendEl.style.color = isRising ? 'var(--aqi-very-poor)' : 'var(--aqi-good)';

        const arrow = trendEl.querySelector('svg path');
        if (arrow) {
          arrow.setAttribute('d', isRising ? 'M7 14l5-5 5 5z' : 'M7 10l5 5 5-5z');
        }
      }
    } else {
      trendTextEl.textContent = '-- /hr';
      trendEl.style.color = 'var(--on-surface-variant)';
    }
  }

  const timeEl = document.getElementById('map-sheet-time');
  if (timeEl) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - data.timestamp_unix;
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);

    let timeText = '';
    if (hours > 0) {
      timeText = `${hours}h ago`;
    } else if (minutes > 0) {
      timeText = `${minutes}m ago`;
    } else {
      timeText = 'Just now';
    }
    timeEl.textContent = timeText;
  }
}

// Global functions for the HTML onclick handlers
(window as any).closeMapDetailSheet = () => {
  const sheet = document.getElementById('map-detail-sheet');
  if (!sheet) return;

  if (sheet.classList.contains('closing')) return;

  sheet.classList.add('closing');

  const handleAnimationEnd = () => {
    sheet.classList.add('hidden');
    sheet.classList.remove('closing');
    currentMapZoneId = null;
    sheet.removeEventListener('animationend', handleAnimationEnd);
  };

  sheet.addEventListener('animationend', handleAnimationEnd);
};

(window as any).openFullDetails = () => {
  if (!currentMapZoneId) return;
  const zoneIdToOpen = currentMapZoneId;
  (window as any).closeMapDetailSheet();
  (window as any).openDetails(zoneIdToOpen);
};
