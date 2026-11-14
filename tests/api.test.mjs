import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { API_URL } from '../.test-build/config.js';
import {
  fetchHistoricalData,
  fetchZones,
  getZoneAQI,
  getZonesAQI,
} from '../.test-build/api.js';

let calls;
let routes;

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  sessionStorage.clear();
  calls = [];
  routes = {};
  globalThis.fetch = async (url) => {
    calls.push(url);
    const path = url.slice(API_URL.length);
    const handler = routes[path];
    if (!handler) {
      return json({ detail: 'not found' }, 404);
    }
    return handler();
  };
});

afterEach(() => {
  delete globalThis.fetch;
});

test('zones are fetched once and cached', async () => {
  routes['/zones?layout=sensors'] = () => json({ zones: [{ id: 'kanipora' }] });

  assert.deepEqual(await fetchZones(), [{ id: 'kanipora' }]);
  assert.deepEqual(await fetchZones(), [{ id: 'kanipora' }]);
  assert.equal(calls.length, 1);
});

test('zones fall back to an empty list on network failure', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await fetchZones(), []);
  } finally {
    console.error = originalError;
  }
});

test('zone AQI cache expires after five minutes', async (t) => {
  routes['/aqi/zone/kanipora'] = () => json({ zone_id: 'kanipora', us_aqi: 80 });
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  t.after(() => {
    Date.now = realNow;
  });

  await getZoneAQI('kanipora');
  now += 4 * 60 * 1000;
  await getZoneAQI('kanipora');
  assert.equal(calls.length, 1);

  now += 2 * 60 * 1000;
  await getZoneAQI('kanipora');
  assert.equal(calls.length, 2);
});

test('zone ids are escaped in the path', async () => {
  await getZoneAQI('a/b c');
  assert.equal(calls[0], `${API_URL}/aqi/zone/a%2Fb%20c`);
});

test('bulk fetch asks only for uncached zones and nulls missing ones', async () => {
  routes['/aqi/zone/kanipora'] = () => json({ zone_id: 'kanipora', us_aqi: 1 });
  await getZoneAQI('kanipora');

  routes['/aqi/zones?ids=bemina,hazratbal'] = () => json({ zones: [{ zone_id: 'bemina', us_aqi: 2 }] });

  const result = await getZonesAQI(['kanipora', 'bemina', 'hazratbal']);

  assert.deepEqual(result, {
    kanipora: { zone_id: 'kanipora', us_aqi: 1 },
    bemina: { zone_id: 'bemina', us_aqi: 2 },
    hazratbal: null,
  });
  assert.equal(calls.at(-1), `${API_URL}/aqi/zones?ids=bemina,hazratbal`);
});

test('bulk fetch with everything cached makes no request', async () => {
  routes['/aqi/zone/kanipora'] = () => json({ zone_id: 'kanipora' });
  await getZoneAQI('kanipora');

  await getZonesAQI(['kanipora']);
  assert.equal(calls.length, 1);
});

test('bulk fetch falls back to one request per zone on an old backend', async () => {
  routes['/aqi/zone/kanipora'] = () => json({ zone_id: 'kanipora' });

  const result = await getZonesAQI(['kanipora', 'bemina']);

  assert.deepEqual(result, { kanipora: { zone_id: 'kanipora' }, bemina: null });
  assert.equal(calls.length, 3);
});

test('history request shape and failure fallback', async () => {
  routes['/historical-data/doda_town/1d/1h/pm2.5,pm10?format=json'] = () => json({ data: [{ ts: 1 }], stats: {} });

  assert.deepEqual(await fetchHistoricalData('doda_town', '1d', '1h'), { data: [{ ts: 1 }], stats: {} });
  assert.deepEqual(await fetchHistoricalData('doda_town', '1d', '1h', 'temp'), { data: [], stats: {} });
});
