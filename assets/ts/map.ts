import { getZoneAQI } from './api.js';
import { getAQIColor, getCurrentTheme, getAQIStandard, formatPollutantName } from './utils.js';
import { Zone, AQIData } from './types.js';
import { STORAGE_KEY_PINS } from './config.js';
import { getPinIcon } from './ui.js';
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
  }

  // Define bounds for J&K region
  const bounds: Leaflet.LatLngBoundsExpression = [
    [31.5, 73.5],  
    [37.0, 80.5]   
  ];

  // center on j&k
  mapInstance = L.map('map-container', { 
    zoomControl: false,
    minZoom: 6,
    maxZoom: 15,
    maxBounds: bounds,
    maxBoundsViscosity: 0.8
  }).setView([33.9, 75.5], 7);

  updateMapTiles(getCurrentTheme());
  populateMapMarkers(allZones);
}

export function updateMapTiles(theme: string): void {
  if (!mapInstance) return;
  if (mapTileLayer) mapTileLayer.remove();

  // lyrs=m (standard roadmap), gl=in (region: india)
  let url = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&gl=in';
  
  mapTileLayer = L.tileLayer(url, {
    attribution: '&copy; Google Maps',
    maxZoom: 20,
    className: theme === 'dark' ? 'dark-map-tiles' : ''
  }).addTo(mapInstance);
}

export function resizeMap(): void {
  if (!mapInstance) return;
  setTimeout(() => mapInstance?.invalidateSize(), 100);
}

function populateMapMarkers(allZones: Zone[]) {
  if (!mapInstance) return;
  
  const std = getAQIStandard();

  allZones.forEach(async (z) => {
    if (!z.lat || !z.lon) return;

    const data = await getZoneAQI(z.id);
    if (!data) return;

    const displayAqi = std === 'us' ? (data.us_aqi || 0) : data.aqi;
    const colors = getAQIColor(displayAqi, std);
    const isLive = z.provider === 'airgradient';
    const liveBadge = isLive ? '<div class="live-badge"></div>' : '';
    const markerHtml = `
            <div style="position: relative;">
              <div style="
                  background-color: ${colors.hex};
                  width: 24px; height: 24px;
                  border-radius: 50%;
                  border: 2px solid #fff;
                  display: flex; align-items: center; justify-content: center;
                  color: #000; font-weight: bold; font-size: 10px;
                  box-shadow: 0 0 10px rgba(0,0,0,0.5);
              ">${displayAqi}</div>
              ${liveBadge}
            </div>
        `;

    const icon = L.divIcon({
      html: markerHtml,
      className: 'custom-pin',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });

    L.marker([z.lat, z.lon], { icon: icon })
      .addTo(mapInstance!)
      .on('click', () => {
        openMapDetailSheet(z.id, z, data);
      });
  });
}

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
  const displayAqi = std === 'us' ? (data.us_aqi || 0) : data.aqi;
  const colors = getAQIColor(displayAqi, std);

  const pinBtn = document.getElementById('map-sheet-pin-btn');
  const pinIcon = document.getElementById('map-sheet-pin-icon');
  const pinText = document.getElementById('map-sheet-pin-text');
  
  if (pinBtn && pinIcon && pinText) {
    const pinnedZoneIds: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY_PINS) || '[]');
    const isPinned = pinnedZoneIds.includes(zone.id);
    pinIcon.innerHTML = getPinIcon(isPinned);
    
    // Resize the SVG if needed
    const svg = pinIcon.querySelector('svg');
    if (svg) {
      svg.style.width = '16px';
      svg.style.height = '16px';
    }
    
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
    aqiBadgeEl.style.color = '#000';
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
    const validHistory = data.history.filter(h => Math.abs(h.ts - oneHourAgo) < 1800);
    
    if (validHistory.length > 0) {
      validHistory.sort((a, b) => Math.abs(a.ts - oneHourAgo) - Math.abs(b.ts - oneHourAgo));
      const pastEntry = validHistory[0];
      const pastVal = std === 'us' ? (pastEntry.us_aqi || 0) : pastEntry.aqi;
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