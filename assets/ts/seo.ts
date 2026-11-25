import { Zone } from './types.js';

export const SITE_URL = 'https://breatheoss.app';

function isEstimatePlace(place: Zone): boolean {
  return place.kind === 'estimate' || place.provider === 'openmeteo';
}

function listNames(names: string[]): string {
  if (names.length < 2) {
    return names.join('');
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function nameWithDistrict(place: Zone): string {
  const district = place.district;
  if (!district || place.name.toLowerCase().includes(district.toLowerCase())) {
    return place.name;
  }
  return `${place.name}, ${district}`;
}

function whereLine(place: Zone, lead: string = ', '): string {
  if (!place.district) {
    return '';
  }
  if (!place.division) {
    return `${lead}${place.district} district`;
  }
  return `${lead}${place.district} district, ${place.division} division`;
}

export function districtMembers(district: Zone, places: Zone[]): Zone[] {
  return places.filter((p) => p.kind !== 'estimate' && p.legacy_zone === district.id);
}

export function placeHeading(place: Zone): string {
  if (place.kind === 'district') {
    return `${place.district} AQI`;
  }
  return place.name;
}

export function placeTitle(place: Zone): string {
  if (place.kind === 'district') {
    return `${place.district} AQI right now, average of ${place.sensors} sensors | Breathe`;
  }
  return `${nameWithDistrict(place)} AQI right now | Breathe`;
}

export function historyTitle(place: Zone): string {
  if (place.kind === 'district') {
    return `${place.district} AQI history | Breathe`;
  }
  return `${place.name} air quality history | Breathe`;
}

export function placeDescription(place: Zone, members: Zone[] = []): string {
  if (place.kind === 'district') {
    return `${place.district} AQI right now, averaged from ${members.length} breatheOSS ground sensors ${members.length > 3 ? 'including' : 'at'} ${listNames(members.slice(0, 3).map((m) => m.name.split(',')[0]))}. US EPA AQI and Indian NAQI with PM2.5, PM10 and history.`;
  }
  if (isEstimatePlace(place)) {
    return `Air quality estimate for ${place.name}${whereLine(place)}, from CAMS satellite data. breatheOSS has no ground sensor here yet.`;
  }
  return `Live AQI for ${place.name}${whereLine(place)}, from a breatheOSS AirGradient ground sensor. US EPA AQI and Indian NAQI with PM2.5, PM10 and history.`;
}

export function placeIntro(place: Zone, members: Zone[] = []): string {
  if (place.kind === 'district') {
    return `The ${place.district} AQI here is the average of ${members.length} breatheOSS ground sensors around ${place.district}${place.division ? ` in ${place.division} division` : ''}. Each of those sensors has its own page below.`;
  }
  if (isEstimatePlace(place)) {
    return `There's no breatheOSS sensor in ${place.name} yet, so this is an estimate from CAMS satellite data via Open-Meteo.${place.district ? ` ${place.name} is${whereLine(place, ' in ')}.` : ''}`;
  }
  return `${place.name} is a breatheOSS ground sensor${whereLine(place, ' in ')}. It's an AirGradient monitor that measures PM2.5 and PM10 on site, shown here as US EPA AQI or Indian NAQI.`;
}

const VIEW_META: { [view: string]: { title: string; description: string } } = {
  dashboard: {
    title: 'Breathe: Live AQI for Jammu & Kashmir and Ladakh',
    description:
      'Free, open-source, real-time air quality (AQI) for Jammu & Kashmir and Ladakh from our own AirGradient ground sensors, with satellite fallback. US EPA and Indian NAQI, live map and history.',
  },
  map: {
    title: 'Air quality map of Jammu & Kashmir and Ladakh | Breathe',
    description:
      'Live map of every breatheOSS ground sensor and satellite estimate in Jammu & Kashmir and Ladakh, coloured by current AQI.',
  },
  explore: {
    title: 'AQI by district in Jammu & Kashmir and Ladakh | Breathe',
    description:
      'Every breatheOSS air quality sensor and satellite estimate in Jammu & Kashmir and Ladakh, grouped by district and division, with live AQI.',
  },
  settings: {
    title: 'Settings | Breathe',
    description:
      'Choose between US EPA AQI and Indian NAQI, raw or calibrated readings, and the theme.',
  },
};

export function viewMeta(view: string): { title: string; description: string } | null {
  return VIEW_META[view] || null;
}

export function areasHeading(place: Zone): string {
  return `${place.district} AQI by area`;
}
