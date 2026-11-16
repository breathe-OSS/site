import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { API_URL } from '../.test-build/config.js';
import { fetchForecast } from '../.test-build/api.js';
import { forecastCity, isForecastOn } from '../.test-build/forecast.js';

const FORECAST = {
  zone_id: 'jammu_city',
  zone_name: 'Jammu',
  model: 'insights-blend-1',
  experimental: true,
  issued_at: 1800000000,
  current: { pm2_5: 40, pm10: 80 },
  points: [15, 30, 60, 180, 360, 720, 1440].map((h) => ({
    horizon_minutes: h,
    ts: 1800000000 + h * 60,
    pm2_5: 40,
    pm10: 80,
    us_aqi: 112,
    aqi: 67,
    uses_day_before: true,
  })),
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

test('forecast is fetched once and cached', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => FORECAST };
  };
  try {
    assert.equal((await fetchForecast('jammu_city')).zone_id, 'jammu_city');
    await fetchForecast('jammu_city');
    assert.deepEqual(calls, [`${API_URL}/forecast/jammu_city`]);
  } finally {
    delete globalThis.fetch;
  }
});

test('forecast failure is null', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  try {
    assert.equal(await fetchForecast('srinagar'), null);
  } finally {
    delete globalThis.fetch;
  }
});

test('only jammu and srinagar sensors get a forecast city', () => {
  assert.equal(forecastCity({ id: 'gandhi-nagar', kind: 'sensor', legacy_zone: 'jammu_city' }), 'jammu_city');
  assert.equal(forecastCity({ id: 'kanipora', kind: 'sensor', legacy_zone: 'srinagar' }), 'srinagar');
  assert.equal(forecastCity({ id: 'srinagar', provider: 'airgradient' }), 'srinagar');
  assert.equal(forecastCity({ id: 'kashtigarh', kind: 'sensor', legacy_zone: 'doda_town' }), null);
  assert.equal(forecastCity({ id: 'jammu_city', kind: 'district' }), null);
  assert.equal(forecastCity({ id: 'jammu_city', kind: 'estimate' }), null);
  assert.equal(forecastCity(null), null);
});

test('forecast toggle is off by default', () => {
  assert.equal(isForecastOn(), false);
  localStorage.setItem('breathe_forecast', 'on');
  assert.equal(isForecastOn(), true);
});
