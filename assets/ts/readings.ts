import { STORAGE_KEY_RAW } from './config.js';
import { AQIData, AQIHistory, Pollutants, SensorReadings, Zone } from './types.js';
import { getAQIStandard } from './utils.js';

type RawModeListener = (on: boolean) => void;

let rawListener: RawModeListener | null = null;

export function isRawMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_RAW) === 'on';
  } catch (e) {
    return false;
  }
}

export function setRawMode(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_RAW, on ? 'on' : 'off');
  } catch (e) {
    return;
  }
  document.documentElement.classList.toggle('raw-mode', on);
  syncRawControls();
  if (rawListener) {
    rawListener(on);
  }
}

export function syncRawControls(): void {
  const on = isRawMode();
  const toggle = document.getElementById('raw-toggle') as HTMLInputElement | null;
  if (toggle) {
    toggle.checked = on;
  }
  document.querySelectorAll<HTMLElement>('[data-raw-choice]').forEach((btn) => {
    const choice = btn.dataset.rawChoice === 'raw';
    btn.classList.toggle('active', choice === on);
    btn.setAttribute('aria-pressed', choice === on ? 'true' : 'false');
  });
}

export function initRawMode(onChange: RawModeListener): void {
  rawListener = onChange;
  document.documentElement.classList.toggle('raw-mode', isRawMode());
  document.documentElement.classList.toggle('raw-hint-hidden', rawHintHidden());
  const settingsPoints = document.getElementById('raw-settings-points');
  if (settingsPoints) {
    settingsPoints.innerHTML = rawExplainerHtml();
  }
  const toggle = document.getElementById('raw-toggle') as HTMLInputElement | null;
  if (toggle) {
    toggle.addEventListener('change', () => setRawMode(toggle.checked));
  }
  syncRawControls();
}

export function rawApplies(data: AQIData | null | undefined): boolean {
  return isRawMode() && !!data && !!data.raw;
}

export function zoneAqi(data: AQIData | null | undefined, std = getAQIStandard()): number {
  if (!data) {
    return 0;
  }
  if (rawApplies(data)) {
    const raw = data.raw!;
    if (std === 'us') {
      return raw.us_aqi ?? 0;
    }
    return raw.aqi ?? 0;
  }
  if (std === 'us') {
    return data.us_aqi || 0;
  }
  return data.aqi;
}

export function zoneMainPollutant(data: AQIData): string {
  const std = getAQIStandard();
  if (rawApplies(data)) {
    const raw = data.raw!;
    if (std === 'us') {
      return raw.us_main_pollutant || raw.main_pollutant || data.main_pollutant;
    }
    return raw.main_pollutant || data.main_pollutant;
  }
  if (std === 'us' && data.us_main_pollutant && data.us_main_pollutant !== 'n/a') {
    return data.us_main_pollutant;
  }
  return data.main_pollutant;
}

export function zoneConcentrations(data: AQIData): Pollutants {
  const base = data.concentrations_us_units || {};
  if (!rawApplies(data)) {
    return base;
  }
  const raw = data.raw!;
  const merged: Pollutants = { ...base };
  if (raw.pm2_5 !== null) {
    merged['pm2_5'] = raw.pm2_5;
  }
  if (raw.pm10 !== null) {
    merged['pm10'] = raw.pm10;
  }
  return merged;
}

export function zoneAverages(data: AQIData): Pollutants | undefined {
  if (rawApplies(data) && data.averages_24h_raw && Object.keys(data.averages_24h_raw).length > 0) {
    return data.averages_24h_raw;
  }
  return data.averages_24h;
}

export function zoneReadings(data: AQIData): SensorReadings | null {
  if (rawApplies(data)) {
    const raw = data.raw!;
    return { pm2_5: raw.pm2_5, pm10: raw.pm10, temp: raw.temp, humidity: raw.humidity };
  }
  return data.readings ?? null;
}

export function historyAqi(entry: AQIHistory, std = getAQIStandard()): number | null {
  if (isRawMode() && entry.pm2_5_raw !== undefined) {
    if (std === 'us') {
      return entry.us_aqi_raw ?? null;
    }
    return entry.aqi_raw ?? null;
  }
  if (std === 'us') {
    return entry.us_aqi || 0;
  }
  return entry.aqi;
}

export function historyPm25(entry: AQIHistory): number | null {
  if (isRawMode() && entry.pm2_5_raw !== undefined) {
    return entry.pm2_5_raw ?? null;
  }
  return entry.pm2_5 ?? null;
}

export function placeLine(
  place: { district?: string; division?: string } | null | undefined
): string {
  if (!place || !place.district) {
    return '';
  }
  if (!place.division) {
    return `Part of the ${place.district} district`;
  }
  return `Part of the ${place.district} district in ${place.division}`;
}

export function isEstimate(zone: Zone | null | undefined): boolean {
  if (!zone) {
    return false;
  }
  if (zone.kind) {
    return zone.kind === 'estimate';
  }
  return zone.provider !== 'airgradient';
}

const STORAGE_KEY_RAW_HINT = 'breathe_raw_hint_hidden';

export const RAW_EXPLAINER_POINTS = [
  {
    title: 'PM<sub>2.5</sub> and PM<sub>10</sub>',
    text: "The laser counter's own numbers, before AirGradient's correction. The correction mostly lowers PM<sub>2.5</sub>, more so in humid air, so raw usually reads higher.",
  },
  {
    title: 'Temperature and humidity',
    text: "Read inside the sensor's case, which warms up in the sun. Raw temperature runs a few degrees high in the afternoon and raw humidity runs low.",
  },
  {
    title: 'AQI, advice and charts',
    text: 'The index, its colour, the health advice, the cigarette count and every chart are worked out again from the raw numbers.',
  },
  {
    title: 'Satellite estimates',
    text: "Places without a sensor have no raw readings, so they don't change.",
  },
  {
    title: 'History',
    text: 'Raw history only goes back to the day Breathe started keeping it. Hours before that show as gaps.',
  },
  {
    title: 'Which one to trust',
    text: 'Calibrated is closer to what a reference monitor would show. Raw is useful for checking the sensor itself or comparing it with another device.',
  },
];

export function rawExplainerHtml(): string {
  const points = RAW_EXPLAINER_POINTS.map(
    (p) =>
      `<div class="raw-point"><div class="raw-point-title">${p.title}</div><div class="raw-point-text">${p.text}</div></div>`
  ).join('');
  return `<div class="raw-points">${points}</div>`;
}

export function rawHintHidden(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_RAW_HINT) === 'yes';
  } catch (e) {
    return false;
  }
}

export function hideRawHint(): void {
  try {
    localStorage.setItem(STORAGE_KEY_RAW_HINT, 'yes');
  } catch (e) {
    return;
  }
  document.documentElement.classList.add('raw-hint-hidden');
}
