import { getZoneAQI } from './api.js';
import { getAQIColor, getCurrentTheme, getAQIStandard } from './utils.js';
import { Zone } from './types.js';
import * as Leaflet from 'leaflet';

declare const L: typeof Leaflet;

// declare global Leaflet variable
let mapInstance: Leaflet.Map | null = null;
let mapTileLayer: Leaflet.TileLayer | null = null;

export function initMap(allZones: Zone[]): void {
  if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
  }

  // center on j&k
  mapInstance = L.map('map-container', { zoomControl: false }).setView([33.9, 75.5], 8);

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
    const markerHtml = `
            <div style="
                background-color: ${colors.hex};
                width: 24px; height: 24px;
                border-radius: 50%;
                border: 2px solid #fff;
                display: flex; align-items: center; justify-content: center;
                color: #000; font-weight: bold; font-size: 10px;
                box-shadow: 0 0 10px rgba(0,0,0,0.5);
            ">${displayAqi}</div>
        `;

    const icon = L.divIcon({
      html: markerHtml,
      className: 'custom-pin',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });

    L.marker([z.lat, z.lon], { icon: icon }).addTo(mapInstance!).bindPopup(`
                <div style="text-align:center; color:#333;">
                    <h3 style="margin:0">${z.name}</h3>
                    <div style="font-size:24px; font-weight:bold; margin:5px 0;">${
                      displayAqi
                    } AQI</div>
                    <small>Primary: ${data.main_pollutant.toUpperCase()}</small>
                </div>
            `);
  });
}