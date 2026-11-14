import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aqiBandIndex,
  aqiTextColor,
  calculateCigarettes,
  calculateNaqiPm25,
  calculateUsAqi,
  calculateUsAqiPm10,
  formatCalendarDate,
  formatPollutantName,
  getAQIBarPosition,
  getAQICategory,
  getAQIStandard,
  getHealthAdvice,
  historyPeriodContaining,
  historyPeriodInterval,
  historyPeriodToken,
  parseCalendarDate,
  pm25ToAqi,
  shiftHistoryPeriod,
} from '../.test-build/utils.js';

const API_US_PM25 = [[0, 0], [0.29, 1], [4.5, 25], [9.0, 50], [9.05, 50], [9.5, 51], [12.0, 56], [20.3, 71], [35.4, 100], [35.5, 101], [47.8, 131], [55.5, 151], [90.0, 175], [125.4, 200], [150.0, 225], [225.4, 300], [225.5, 301], [300.0, 449], [325.4, 500], [400.0, 648]];
const API_US_PM10 = [[0, 0], [30.7, 27], [54.9, 50], [55, 51], [100.2, 73], [154, 100], [200, 123], [300, 173], [424.9, 300], [480, 369], [604, 500], [700, 596]];
const API_NAQI_PM25 = [[0, 0], [15.5, 25], [30.9, 50], [31, 51], [45.2, 74], [60, 100], [75, 148], [90.9, 200], [105, 248], [120, 300], [200, 361], [250, 400], [300, 438], [380, 500]];

test('US PM2.5 AQI matches the API', () => {
  for (const [pm, aqi] of API_US_PM25) {
    assert.equal(calculateUsAqi(pm), aqi, `pm2.5 ${pm}`);
  }
});

test('US PM10 AQI matches the API', () => {
  for (const [pm, aqi] of API_US_PM10) {
    assert.equal(calculateUsAqiPm10(pm), aqi, `pm10 ${pm}`);
  }
});

test('NAQI PM2.5 matches the API up to 500', () => {
  for (const [pm, aqi] of API_NAQI_PM25) {
    assert.equal(calculateNaqiPm25(pm), aqi, `pm2.5 ${pm}`);
  }
  assert.equal(calculateNaqiPm25(2000), 500);
});

test('negative concentrations read as zero', () => {
  assert.equal(calculateUsAqi(-3), 0);
  assert.equal(calculateUsAqiPm10(-3), 0);
  assert.equal(calculateNaqiPm25(-3), 0);
});

test('pm25ToAqi picks the scale', () => {
  assert.equal(pm25ToAqi(60, 'us'), calculateUsAqi(60));
  assert.equal(pm25ToAqi(60, 'india'), calculateNaqiPm25(60));
});

test('category labels at band edges', () => {
  assert.equal(getAQICategory(50), 'Good');
  assert.equal(getAQICategory(51), 'Moderate');
  assert.equal(getAQICategory(150), 'Unhealthy for Sensitive Groups');
  assert.equal(getAQICategory(151), 'Unhealthy');
  assert.equal(getAQICategory(300), 'Very Unhealthy');
  assert.equal(getAQICategory(301), 'Hazardous');
  assert.equal(getAQICategory(100, 'india'), 'Satisfactory');
  assert.equal(getAQICategory(200, 'india'), 'Moderate');
  assert.equal(getAQICategory(400, 'india'), 'Very Poor');
  assert.equal(getAQICategory(401, 'india'), 'Severe');
});

test('band index agrees with the category for every value', () => {
  const us = ['Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy', 'Hazardous'];
  const india = ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe'];
  for (let aqi = 0; aqi <= 600; aqi++) {
    assert.equal(us[aqiBandIndex(aqi, 'us')], getAQICategory(aqi, 'us'), `us ${aqi}`);
    assert.equal(india[aqiBandIndex(aqi, 'india')], getAQICategory(aqi, 'india'), `india ${aqi}`);
  }
});

test('health advice follows the band', () => {
  assert.equal(getHealthAdvice(10).title, 'Good time to be outside');
  assert.equal(getHealthAdvice(500).title, 'Stay indoors');
  assert.equal(getHealthAdvice(250, 'india').title, getHealthAdvice(160, 'us').title);
});

test('bar position rises with the index and stays on the bar', () => {
  for (const std of ['us', 'india']) {
    let last = -1;
    for (let aqi = 0; aqi <= 1000; aqi += 5) {
      const pos = getAQIBarPosition(aqi, std);
      assert.ok(pos >= last, `${std} ${aqi}`);
      assert.ok(pos >= 0 && pos <= 100, `${std} ${aqi}`);
      last = pos;
    }
  }
});

test('text colour flips on dark bands', () => {
  assert.equal(aqiTextColor(150), '#1a1c22');
  assert.equal(aqiTextColor(151), '#ffffff');
  assert.equal(aqiTextColor(400, 'india'), '#1a1c22');
  assert.equal(aqiTextColor(401, 'india'), '#ffffff');
});

test('cigarettes and pollutant names', () => {
  assert.equal(calculateCigarettes(22), 1);
  assert.equal(calculateCigarettes(55), 2.5);
  assert.equal(formatPollutantName('pm2_5'), 'PM<sub>2.5</sub>');
  assert.equal(formatPollutantName('pm10'), 'PM<sub>10</sub>');
  assert.equal(formatPollutantName('no2'), 'NO2');
});

test('standard defaults to US and remembers India', () => {
  localStorage.clear();
  assert.equal(getAQIStandard(), 'us');
  localStorage.setItem('aqi_standard', 'india');
  assert.equal(getAQIStandard(), 'india');
  localStorage.setItem('aqi_standard', 'garbage');
  assert.equal(getAQIStandard(), 'us');
  localStorage.clear();
});

test('calendar dates round trip', () => {
  assert.equal(formatCalendarDate(parseCalendarDate('2026-03-07')), '2026-03-07');
  assert.equal(parseCalendarDate('2026-3-7'), null);
  assert.equal(parseCalendarDate('yesterday'), null);
});

test('month period covers the whole month', () => {
  const feb = historyPeriodContaining('month', parseCalendarDate('2028-02-14'));
  assert.equal(formatCalendarDate(feb.start), '2028-02-01');
  assert.equal(formatCalendarDate(feb.end), '2028-02-29');
});

test('week period starts on Monday', () => {
  const saturday = historyPeriodContaining('week', parseCalendarDate('2026-11-14'));
  assert.equal(formatCalendarDate(saturday.start), '2026-11-09');
  assert.equal(formatCalendarDate(saturday.end), '2026-11-15');

  const sunday = historyPeriodContaining('week', parseCalendarDate('2026-11-15'));
  assert.equal(formatCalendarDate(sunday.start), '2026-11-09');

  const monday = historyPeriodContaining('week', parseCalendarDate('2026-11-16'));
  assert.equal(formatCalendarDate(monday.start), '2026-11-16');
});

test('shifting periods', () => {
  const dec = historyPeriodContaining('month', parseCalendarDate('2026-12-31'));
  const jan = shiftHistoryPeriod('month', dec, 1);
  assert.equal(formatCalendarDate(jan.start), '2027-01-01');
  assert.equal(formatCalendarDate(jan.end), '2027-01-31');

  const span = { start: parseCalendarDate('2026-10-01'), end: parseCalendarDate('2026-10-03') };
  const back = shiftHistoryPeriod('days', span, -1);
  assert.equal(formatCalendarDate(back.start), '2026-09-28');
  assert.equal(formatCalendarDate(back.end), '2026-09-30');
});

test('period token is the span the API accepts', () => {
  const week = historyPeriodContaining('week', parseCalendarDate('2026-11-14'));
  const token = historyPeriodToken(week);
  assert.equal(token, '2026-11-09_2026-11-15');
  assert.match(token, /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/);
});

test('interval grows with the period length', () => {
  const span = (a, b) => ({ start: parseCalendarDate(a), end: parseCalendarDate(b) });
  assert.equal(historyPeriodInterval(span('2026-10-01', '2026-10-14')), '1h');
  assert.equal(historyPeriodInterval(span('2026-10-01', '2026-10-15')), '4h');
  assert.equal(historyPeriodInterval(span('2026-10-01', '2026-12-01')), '4h');
  assert.equal(historyPeriodInterval(span('2026-10-01', '2026-12-02')), '1d');
});
