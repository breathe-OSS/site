import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  historyAqi,
  historyPm25,
  isEstimate,
  isRawMode,
  placeLine,
  rawApplies,
  zoneAqi,
  zoneAverages,
  zoneConcentrations,
  zoneMainPollutant,
  zoneReadings,
} from '../.test-build/readings.js';

const sensor = {
  zone_id: 'kanipora',
  aqi: 120,
  us_aqi: 160,
  main_pollutant: 'pm2_5',
  us_main_pollutant: 'pm2_5',
  concentrations_us_units: { pm2_5: 70, pm10: 90, no2: 12 },
  averages_24h: { pm2_5: 50 },
  averages_24h_raw: { pm2_5: 80 },
  readings: { pm2_5: 70, pm10: 90, temp: 10, humidity: 60 },
  raw: {
    pm2_5: 110,
    pm10: null,
    temp: 14,
    humidity: 45,
    aqi: 310,
    us_aqi: 190,
    main_pollutant: 'pm2_5',
    us_main_pollutant: 'pm10',
  },
};

const estimate = { ...sensor, zone_id: 'anantnag_city', raw: null, averages_24h_raw: {} };

function rawMode(on) {
  localStorage.setItem('breathe_raw_readings', on ? 'on' : 'off');
}

beforeEach(() => {
  localStorage.clear();
});

test('raw mode is off by default', () => {
  assert.equal(isRawMode(), false);
  assert.equal(rawApplies(sensor), false);
});

test('raw only applies to places that have raw readings', () => {
  rawMode(true);
  assert.equal(rawApplies(sensor), true);
  assert.equal(rawApplies(estimate), false);
  assert.equal(rawApplies(null), false);
});

test('zone AQI per standard and mode', () => {
  assert.equal(zoneAqi(sensor, 'us'), 160);
  assert.equal(zoneAqi(sensor, 'india'), 120);
  assert.equal(zoneAqi(null, 'us'), 0);

  rawMode(true);
  assert.equal(zoneAqi(sensor, 'us'), 190);
  assert.equal(zoneAqi(sensor, 'india'), 310);
  assert.equal(zoneAqi(estimate, 'us'), 160);
});

test('main pollutant falls back when the US one is n/a', () => {
  localStorage.setItem('aqi_standard', 'us');
  assert.equal(zoneMainPollutant({ ...sensor, us_main_pollutant: 'n/a', main_pollutant: 'pm10' }), 'pm10');

  rawMode(true);
  assert.equal(zoneMainPollutant(sensor), 'pm10');
});

test('raw concentrations only replace particulates that exist', () => {
  rawMode(true);
  assert.deepEqual(zoneConcentrations(sensor), { pm2_5: 110, pm10: 90, no2: 12 });
});

test('raw averages fall back when empty', () => {
  rawMode(true);
  assert.deepEqual(zoneAverages(sensor), { pm2_5: 80 });
  assert.deepEqual(zoneAverages({ ...sensor, averages_24h_raw: {} }), { pm2_5: 50 });
});

test('readings switch to the raw block', () => {
  assert.deepEqual(zoneReadings(sensor), sensor.readings);
  rawMode(true);
  assert.deepEqual(zoneReadings(sensor), { pm2_5: 110, pm10: null, temp: 14, humidity: 45 });
});

test('history entries in raw mode', () => {
  const corrected = { ts: 1, aqi: 80, us_aqi: 100, pm2_5: 30 };
  const withRaw = { ...corrected, pm2_5_raw: 55, aqi_raw: 95, us_aqi_raw: null };

  assert.equal(historyAqi(withRaw, 'us'), 100);
  assert.equal(historyPm25(withRaw), 30);

  rawMode(true);
  assert.equal(historyAqi(withRaw, 'us'), null);
  assert.equal(historyAqi(withRaw, 'india'), 95);
  assert.equal(historyPm25(withRaw), 55);
  assert.equal(historyAqi(corrected, 'us'), 100);
});

test('place line', () => {
  assert.equal(placeLine(null), '');
  assert.equal(placeLine({ division: 'Jammu' }), '');
  assert.equal(placeLine({ district: 'Doda' }), 'Part of the Doda district');
  assert.equal(placeLine({ district: 'Doda', division: 'Jammu' }), 'Part of the Doda district in Jammu');
});

test('estimate detection prefers kind over provider', () => {
  assert.equal(isEstimate({ kind: 'estimate', provider: 'airgradient' }), true);
  assert.equal(isEstimate({ kind: 'sensor', provider: 'openmeteo' }), false);
  assert.equal(isEstimate({ provider: 'openmeteo' }), true);
  assert.equal(isEstimate({ provider: 'airgradient' }), false);
  assert.equal(isEstimate(null), false);
});
