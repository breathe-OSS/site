import { getZonesAQI, getSensorInfoList } from './api.js';
import {
  getAQIColor,
  getCurrentTheme,
  getAQIStandard,
  formatPollutantName,
  aqiTextColor,
} from './utils.js';
import { Zone, AQIData, SensorInfo } from './types.js';
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
}

let regionBounds: Leaflet.LatLngBounds | null = null;
let userMovedMap = false;
let fittingMap = false;

function fitToRegion() {
  if (!mapInstance || !regionBounds) {
    return;
  }
  fittingMap = true;
  const bottom = window.innerWidth < 768 ? 120 : 40;
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
  renderMapMarkers();
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
          aqi: isOffline ? null : displayAqiOf(node.us_aqi, node.aqi),
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
      aqi: displayAqiOf(data.us_aqi, data.aqi),
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
