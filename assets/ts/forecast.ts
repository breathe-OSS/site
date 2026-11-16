import { fetchForecast } from './api.js';
import { STORAGE_KEY_FORECAST } from './config.js';
import { Forecast, Zone } from './types.js';
import { aqiTextColor, getAQICategory, getAQIColor, getAQIStandard } from './utils.js';
import { isEstimate } from './readings.js';

const FORECAST_CITIES = ['jammu_city', 'srinagar'];
const SHOWN_HORIZONS = [60, 180, 360, 720];

const requests: { [targetId: string]: number } = {};

export function isForecastOn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_FORECAST) === 'on';
  } catch (e) {
    return false;
  }
}

export function initForecastToggle(onChange: () => void): void {
  const toggle = document.getElementById('forecast-toggle') as HTMLInputElement | null;
  if (!toggle) {
    return;
  }
  toggle.checked = isForecastOn();
  toggle.addEventListener('change', () => {
    try {
      localStorage.setItem(STORAGE_KEY_FORECAST, toggle.checked ? 'on' : 'off');
    } catch (e) {
      return;
    }
    onChange();
  });
}

export function forecastCity(zone: Zone | null | undefined): string | null {
  if (!zone || isEstimate(zone) || zone.kind === 'district') {
    return null;
  }
  const city = zone.legacy_zone || zone.id;
  if (!FORECAST_CITIES.includes(city)) {
    return null;
  }
  return city;
}

function horizonLabel(minutes: number): string {
  return `In ${minutes / 60}h`;
}

export function forecastCardHtml(forecast: Forecast, zone: Zone): string {
  const std = getAQIStandard();
  const slots = forecast.points
    .filter((point) => SHOWN_HORIZONS.includes(point.horizon_minutes))
    .map((point) => {
      const aqi = std === 'us' ? point.us_aqi : point.aqi;
      const color = getAQIColor(aqi, std).hex;
      return `
        <div class="forecast-slot">
          <span class="forecast-when">${horizonLabel(point.horizon_minutes)}</span>
          <span class="forecast-aqi aqi-badge-small" style="background: ${color}; color: ${aqiTextColor(aqi, std)};">${aqi}</span>
          <span class="forecast-category">${getAQICategory(aqi, std)}</span>
        </div>
      `;
    })
    .join('');
  const scope =
    zone.id === forecast.zone_id
      ? `${forecast.zone_name} average`
      : `${forecast.zone_name} average, not just this sensor`;
  return `
    <div class="forecast-head">
      <div>
        <div class="forecast-title">Forecast <span class="forecast-tag">Experimental</span></div>
        <div class="forecast-sub">${scope}</div>
      </div>
    </div>
    <div class="forecast-slots">${slots}</div>
    <p class="forecast-note">Blends the latest reading with the same hour yesterday. It can't see rain or wind coming, so treat it as a rough guide.</p>
  `;
}

export async function renderForecastCard(targetId: string, zone: Zone): Promise<void> {
  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }
  const request = (requests[targetId] || 0) + 1;
  requests[targetId] = request;

  const city = forecastCity(zone);
  if (!city || !isForecastOn()) {
    target.innerHTML = '';
    target.classList.add('hidden');
    return;
  }

  const forecast = await fetchForecast(city);
  if (requests[targetId] !== request) {
    return;
  }
  if (!forecast || !forecast.points || forecast.points.length === 0) {
    target.innerHTML = '';
    target.classList.add('hidden');
    return;
  }
  target.innerHTML = forecastCardHtml(forecast, zone);
  target.classList.remove('hidden');
}
