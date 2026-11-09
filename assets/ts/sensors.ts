// node detail sheet, shared by the node cards on a zone and the sensors on the map

import { getSensorInfoList } from './api.js';
import { NodeData } from './types.js';
import { getAQIStandard } from './utils.js';

// an offline sensor (no pm2.5) still shows which box it is, with a banner on
// top explaining why its readings are missing
// onOpenZone adds a button through to the whole zone, the map passes it
export async function showNodeSheet(
  nodeName: string,
  node: NodeData,
  zoneName?: string,
  onOpenZone?: () => void
) {
  const sheet = document.getElementById('node-detail-sheet');
  const title = document.getElementById('node-sheet-title');
  if (!sheet || !title) return;

  const setText = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.innerText = text;
    }
  };

  title.innerText = nodeName;

  const isOffline = node.pm2_5 === null || node.pm2_5 === undefined;
  document.getElementById('node-sheet-offline')?.classList.toggle('hidden', !isOffline);
  document.getElementById('node-sheet-readings')?.classList.toggle('hidden', isOffline);

  const std = getAQIStandard();
  const aqi = std === 'us' ? (node.us_aqi ?? node.aqi) : node.aqi;
  setText('node-sheet-aqi', aqi?.toString() ?? '--');
  setText('node-sheet-std', std === 'us' ? 'US AQI' : 'NAQI');
  setText('node-sheet-pm25', node.pm2_5 != null ? `${node.pm2_5} µg/m³` : '--');
  setText('node-sheet-pm10', node.pm10 != null ? `${node.pm10} µg/m³` : '--');
  setText('node-sheet-temp', node.temp != null ? `${node.temp} °C` : '--');
  setText('node-sheet-humid', node.humidity != null ? `${node.humidity}%` : '--');

  // names are only unique inside a zone, so match the zone too when we know it
  const sensors = await getSensorInfoList();
  const info =
    sensors?.find((s) => s.name === nodeName && (!zoneName || s.zone === zoneName)) ?? null;

  setText('node-sheet-provider', info?.provider || '--');
  setText('node-sheet-model', info?.model || '--');
  setText('node-sheet-locid', info?.location_id?.toString() || '--');
  setText('node-sheet-install', info?.installation_date || '--');

  const openZoneBtn = document.getElementById('node-sheet-open-zone');
  if (openZoneBtn) {
    openZoneBtn.classList.toggle('hidden', !onOpenZone);
    openZoneBtn.innerText = `Open ${zoneName ?? 'zone'}`;
    openZoneBtn.onclick = () => {
      sheet.classList.add('hidden');
      onOpenZone?.();
    };
  }

  sheet.classList.remove('hidden');
}
