import { API_URL } from './config.js';
import { fetchHistoricalData, fetchWeatherHistory } from './api.js';
import { WeatherHistory, Zone } from './types.js';
import {
  HistoryPeriod,
  HistoryPeriodMode,
  aqiBandIndex,
  formatCalendarDate,
  getAQICategory,
  getAQIColor,
  getCurrentTheme,
  historyPeriodContaining,
  historyPeriodLabel,
  historyPeriodToken,
  parseCalendarDate,
  shiftHistoryPeriod,
} from './utils.js';
import { isEstimate, isRawMode, placeLine, rawExplainerHtml } from './readings.js';
import { clearExtendedSelection, hexToRgba, renderExtendedDotsGrid } from './ui.js';
import type { Chart as ChartJS, ChartConfiguration, Plugin } from 'chart.js';

declare const Chart: typeof ChartJS;
type LineChart = InstanceType<typeof Chart<'line', (number | null)[], string>>;

type Metric = 'aqi' | 'pm25' | 'pm10' | 'pm' | 'temp' | 'humidity';
type Mode = 'cal' | 'raw' | 'both';

interface Row {
  ts: number;
  [key: string]: number | null | string;
}

interface Series {
  key: string;
  label: string;
  raw: boolean;
  hue: 'primary' | 'secondary' | 'raw';
}

interface MetricDef {
  label: string;
  unit: string;
  cal: string[];
  names: string[];
  bands: number[] | null;
  decimals: number;
}

const ALL_METRICS =
  'pm2.5,pm10,temp,humidity,us_aqi,pm2.5_raw,pm10_raw,temp_raw,humidity_raw,us_aqi_raw';

const US_AQI_BANDS = [0, 50, 100, 150, 200, 300, 500];
const PM25_BANDS = [0, 9, 35.4, 55.4, 125.4, 225.4, 325.4];
const PM10_BANDS = [0, 54, 154, 254, 354, 424, 604];

const METRICS: { [key in Metric]: MetricDef } = {
  aqi: {
    label: 'US AQI',
    unit: 'US AQI',
    cal: ['us_aqi'],
    names: ['US AQI'],
    bands: US_AQI_BANDS,
    decimals: 0,
  },
  pm25: {
    label: 'PM2.5',
    unit: 'µg/m³',
    cal: ['pm2_5'],
    names: ['PM2.5'],
    bands: PM25_BANDS,
    decimals: 1,
  },
  pm10: {
    label: 'PM10',
    unit: 'µg/m³',
    cal: ['pm10'],
    names: ['PM10'],
    bands: PM10_BANDS,
    decimals: 1,
  },
  pm: {
    label: 'PM2.5 + PM10',
    unit: 'µg/m³',
    cal: ['pm2_5', 'pm10'],
    names: ['PM2.5', 'PM10'],
    bands: null,
    decimals: 1,
  },
  temp: {
    label: 'Temperature',
    unit: '°C',
    cal: ['temp'],
    names: ['Temperature'],
    bands: null,
    decimals: 1,
  },
  humidity: {
    label: 'Humidity',
    unit: '%',
    cal: ['humidity'],
    names: ['Humidity'],
    bands: null,
    decimals: 0,
  },
};

const WEATHER_LABELS: { [key: string]: string } = {
  rain: 'Rain',
  snow: 'Snow',
  fog: 'Fog',
  cloudy: 'Cloudy',
  clear: 'Clear',
};

const GENERIC_RAW_NOTE = "Showing the sensor's uncorrected readings.";

const US_CATEGORY_SAMPLES = [25, 75, 125, 175, 250, 400];

let showView: (name: string) => void = () => undefined;

let historyZone: Zone | null = null;
let currentRange = '1w';
let currentInterval = '1h';
let metric: Metric = 'aqi';
let mode: Mode = 'cal';
let weatherFilter = 'all';
let rows: Row[] = [];
let weather: WeatherHistory | null = null;
let periodMode: HistoryPeriodMode = 'month';
let period: HistoryPeriod | null = null;
let requestId = 0;

let mainChart: LineChart | null = null;
let hourChart: LineChart | null = null;

export function initHistory(show: (name: string) => void, places: () => Zone[]) {
  showView = show;
  getPlaces = places;
}

export function historyZoneId(): string | null {
  return historyZone ? historyZone.id : null;
}

function rawKey(key: string): string {
  return `${key}_raw`;
}

function activeSeries(): Series[] {
  const def = METRICS[metric];
  const series: Series[] = [];
  def.cal.forEach((key, i) => {
    const hue = i === 0 ? 'primary' : 'secondary';
    if (mode !== 'raw') {
      series.push({ key, label: def.names[i], raw: false, hue });
    }
    if (mode !== 'cal') {
      series.push({
        key: rawKey(key),
        label: `${def.names[i]} raw`,
        raw: true,
        hue: def.cal.length === 1 && mode === 'both' ? 'raw' : hue,
      });
    }
  });
  return series;
}

function seriesColor(series: Series): string {
  const dark = getCurrentTheme() === 'dark';
  if (series.hue === 'raw') {
    return dark ? '#d95926' : '#eb6834';
  }
  if (series.hue === 'secondary') {
    return dark ? '#199e70' : '#1baf7a';
  }
  return dark ? '#3987e5' : '#2a78d6';
}

function num(row: Row, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' ? value : null;
}

function fmt(value: number | null, decimals = METRICS[metric].decimals): string {
  if (value === null || isNaN(value)) {
    return '--';
  }
  return decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals);
}

function conditionForTs(ts: number): string | null {
  if (!weather || weather.points.length === 0) {
    return null;
  }
  const anchor = weather.anchor ?? 0;
  const bucket = anchor + Math.floor((ts - anchor) / weather.interval) * weather.interval;
  const point = weather.points.find((p) => p.ts === bucket);
  if (!point) {
    return null;
  }
  return point.condition === 'thunderstorm' ? 'rain' : point.condition;
}

function filteredRows(): Row[] {
  if (weatherFilter === 'all') {
    return rows;
  }
  return rows.filter((row) => conditionForTs(row.ts) === weatherFilter);
}

function intervalSeconds(token: string): number {
  const match = /^(\d+)\s*(mo|m|h|d|w)$/.exec(token.trim().toLowerCase());
  if (!match) {
    return 3600;
  }
  const n = parseInt(match[1], 10);
  const unit: { [key: string]: number } = { m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000 };
  return n * unit[match[2]];
}

function displayBucket(points: Row[]): number {
  const base = intervalSeconds(currentInterval);
  if (points.length < 2) {
    return base;
  }
  const span = points[points.length - 1].ts - points[0].ts;
  if (span > 62 * 86400) {
    return Math.max(base, 86400);
  }
  if (span > 14 * 86400) {
    return Math.max(base, 4 * 3600);
  }
  return base;
}

function aggregate(points: Row[], bucket: number, keys: string[]): Row[] {
  if (bucket <= intervalSeconds(currentInterval)) {
    return points;
  }
  const offset = new Date().getTimezoneOffset() * 60;
  const out: Row[] = [];
  let current: {
    ts: number;
    sums: { [k: string]: number };
    counts: { [k: string]: number };
  } | null = null;
  const flush = () => {
    if (!current) return;
    const row: Row = { ts: current.ts };
    keys.forEach((k) => {
      row[k] = current!.counts[k] ? current!.sums[k] / current!.counts[k] : null;
    });
    out.push(row);
  };
  points.forEach((p) => {
    const start = Math.floor((p.ts - offset) / bucket) * bucket + offset;
    if (!current || current.ts !== start) {
      flush();
      current = { ts: start, sums: {}, counts: {} };
    }
    keys.forEach((k) => {
      const v = num(p, k);
      if (v !== null) {
        current!.sums[k] = (current!.sums[k] || 0) + v;
        current!.counts[k] = (current!.counts[k] || 0) + 1;
      }
    });
  });
  flush();
  return out;
}

function timeLabel(ts: number, bucket: number): string {
  const d = new Date(ts * 1000);
  const day = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (bucket >= 86400) {
    return day;
  }
  const hh = d.getHours() < 10 ? `0${d.getHours()}` : `${d.getHours()}`;
  return `${day} ${hh}:00`;
}

function bandColorFor(value: number, bands: number[]): string {
  const sample =
    US_CATEGORY_SAMPLES[Math.min(Math.max(bands.findIndex((b) => value < b) - 1, 0), 5)];
  return getAQIColor(sample, 'us').hex;
}

const categoryBands: Plugin<'line'> = {
  id: 'categoryBands',
  beforeDatasetsDraw(chart) {
    const bands = METRICS[metric].bands;
    const { ctx, chartArea, scales } = chart;
    const y = scales.y;
    if (!bands || !chartArea || !y) return;
    ctx.save();
    for (let i = 0; i < bands.length - 1; i++) {
      const top = y.getPixelForValue(bands[i + 1]);
      const bottom = y.getPixelForValue(bands[i]);
      const clippedTop = Math.max(top, chartArea.top);
      const clippedBottom = Math.min(bottom, chartArea.bottom);
      if (clippedBottom <= clippedTop) continue;
      ctx.fillStyle = hexToRgba(getAQIColor(US_CATEGORY_SAMPLES[i], 'us').hex, 0.07);
      ctx.fillRect(
        chartArea.left,
        clippedTop,
        chartArea.right - chartArea.left,
        clippedBottom - clippedTop
      );
    }
    ctx.restore();
  },
};

function chartTheme() {
  const dark = getCurrentTheme() === 'dark';
  return {
    tick: dark ? '#9aa0aa' : '#64748b',
    grid: dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
    text: dark ? '#e2e2e9' : '#1a1c22',
  };
}

function datasetFor(series: Series, data: (number | null)[]) {
  const color = seriesColor(series);
  return {
    label: series.label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    borderDash: series.raw ? [6, 4] : [],
    tension: 0.3,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBorderWidth: 2,
    pointHoverBorderColor: getCurrentTheme() === 'dark' ? '#1a1c22' : '#fcfcfb',
    spanGaps: false,
    fill: false,
  };
}

function renderMainChart(points: Row[]) {
  const canvas = document.getElementById('extendedHistoryChart') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (mainChart) {
    mainChart.destroy();
    mainChart = null;
  }

  const series = activeSeries();
  const bucket = displayBucket(points);
  const shown = aggregate(
    points,
    bucket,
    series.map((s) => s.key)
  );
  const def = METRICS[metric];
  const theme = chartTheme();

  const titleEl = document.getElementById('hist-chart-title');
  const subEl = document.getElementById('hist-chart-sub');
  if (titleEl) titleEl.textContent = def.label;
  if (subEl) {
    const step =
      bucket >= 86400 ? 'daily averages' : bucket >= 4 * 3600 ? '4 hour averages' : 'hourly';
    subEl.textContent = `${def.unit}, ${step}${def.bands ? ', shaded by US AQI category' : ''}`;
  }

  const config: ChartConfiguration<'line', (number | null)[], string> = {
    type: 'line',
    data: {
      labels: shown.map((p) => timeLabel(p.ts, bucket)),
      datasets: series.map((s) =>
        datasetFor(
          s,
          shown.map((p) => num(p, s.key))
        )
      ),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: series.length > 1,
          position: 'top',
          align: 'start',
          labels: { color: theme.text, usePointStyle: true, pointStyle: 'line', boxWidth: 24 },
        },
        tooltip: {
          callbacks: {
            label: (c) => {
              const value = typeof c.raw === 'number' ? c.raw : null;
              let text =
                `${c.dataset.label}  ${fmt(value)} ${def.unit === 'US AQI' ? '' : def.unit}`.trim();
              if (value !== null && metric === 'aqi') {
                text += `  ·  ${getAQICategory(value, 'us')}`;
              }
              return text;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: theme.tick,
            maxTicksLimit: window.innerWidth < 600 ? 4 : 7,
            maxRotation: 0,
            autoSkip: true,
            font: { size: 11 },
          },
        },
        y: {
          beginAtZero: metric !== 'temp',
          position: 'right',
          border: { display: false },
          grid: { color: theme.grid },
          ticks: { color: theme.tick, maxTicksLimit: 6, font: { size: 11 } },
        },
      },
    },
    plugins: [categoryBands],
  };
  mainChart = new Chart(ctx, config);
}

function renderHourProfile(points: Row[]) {
  const canvas = document.getElementById('hourProfileChart') as HTMLCanvasElement | null;
  const card = document.getElementById('hist-hour-card');
  if (!canvas || !card) return;
  if (hourChart) {
    hourChart.destroy();
    hourChart = null;
  }
  const hourly = intervalSeconds(currentInterval) <= 3600;
  card.classList.toggle('hidden', !hourly || points.length === 0);
  if (!hourly || points.length === 0) return;

  const series = activeSeries();
  const sums = series.map(() => new Array(24).fill(0));
  const counts = series.map(() => new Array(24).fill(0));
  points.forEach((p) => {
    const hour = new Date(p.ts * 1000).getHours();
    series.forEach((s, i) => {
      const v = num(p, s.key);
      if (v !== null) {
        sums[i][hour] += v;
        counts[i][hour] += 1;
      }
    });
  });

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const theme = chartTheme();
  const def = METRICS[metric];
  const sub = document.getElementById('hist-hour-sub');
  if (sub) {
    sub.textContent = `Average ${def.label} at each hour of the day, local time`;
  }

  const config: ChartConfiguration<'line', (number | null)[], string> = {
    type: 'line',
    data: {
      labels: Array.from({ length: 24 }, (_, h) => (h < 10 ? `0${h}:00` : `${h}:00`)),
      datasets: series.map((s, i) =>
        datasetFor(
          s,
          sums[i].map((total, h) => (counts[i][h] ? total / counts[i][h] : null))
        )
      ),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: series.length > 1,
          position: 'top',
          align: 'start',
          labels: { color: theme.text, usePointStyle: true, pointStyle: 'line', boxWidth: 24 },
        },
        tooltip: {
          callbacks: {
            label: (c) => {
              const value = typeof c.raw === 'number' ? c.raw : null;
              return `${c.dataset.label}  ${fmt(value)} ${def.unit === 'US AQI' ? '' : def.unit}`.trim();
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: theme.tick, maxTicksLimit: 8, maxRotation: 0, font: { size: 11 } },
        },
        y: {
          beginAtZero: metric !== 'temp',
          position: 'right',
          border: { display: false },
          grid: { color: theme.grid },
          ticks: { color: theme.tick, maxTicksLimit: 5, font: { size: 11 } },
        },
      },
    },
    plugins: [categoryBands],
  };
  hourChart = new Chart(ctx, config);
}

function stats(points: Row[], key: string) {
  let sum = 0;
  let count = 0;
  let max: { v: number; ts: number } | null = null;
  let min: { v: number; ts: number } | null = null;
  points.forEach((p) => {
    const v = num(p, key);
    if (v === null) return;
    sum += v;
    count += 1;
    if (!max || v > max.v) max = { v, ts: p.ts };
    if (!min || v < min.v) min = { v, ts: p.ts };
  });
  return { avg: count ? sum / count : null, max, min, count };
}

function valueColor(key: string, value: number | null): string {
  if (value === null) return 'var(--on-surface)';
  const base = key.replace(/_raw$/, '');
  if (base === 'us_aqi') return getAQIColor(value, 'us').hex;
  if (base === 'pm2_5') return bandColorFor(value, PM25_BANDS);
  if (base === 'pm10') return bandColorFor(value, PM10_BANDS);
  return 'var(--on-surface)';
}

function whenText(ts: number): string {
  const bucket = intervalSeconds(currentInterval);
  return timeLabel(ts, bucket);
}

function renderSummary(points: Row[]) {
  const host = document.getElementById('history-summary');
  if (!host) return;
  if (points.length === 0) {
    host.innerHTML = '';
    host.classList.add('hidden');
    return;
  }
  host.classList.remove('hidden');
  const def = METRICS[metric];
  const unit = def.unit === 'US AQI' ? '' : ` ${def.unit}`;

  const blocks = activeSeries()
    .map((s) => {
      const st = stats(points, s.key);
      if (st.count === 0) {
        return `
          <div class="summary-block">
            <div class="summary-label">${s.label}</div>
            <div class="summary-value muted">No readings</div>
          </div>`;
      }
      const maxV = st.max as unknown as { v: number; ts: number };
      const minV = st.min as unknown as { v: number; ts: number };
      return `
        <div class="summary-block">
          <div class="summary-label">${s.label} average</div>
          <div class="summary-value" style="color: ${valueColor(s.key, st.avg)};">${fmt(st.avg)}<span class="summary-unit">${unit}</span></div>
          <div class="summary-note">Peak ${fmt(maxV.v)} on ${whenText(maxV.ts)} · low ${fmt(minV.v)}</div>
        </div>`;
    })
    .join('');

  const aqiKey = mode === 'raw' ? 'us_aqi_raw' : 'us_aqi';
  const tally = new Array(6).fill(0);
  let tallied = 0;
  points.forEach((p) => {
    const v = num(p, aqiKey);
    if (v === null) return;
    tally[aqiBandIndex(v, 'us')] += 1;
    tallied += 1;
  });

  let categories = '';
  if (tallied > 0) {
    const segments = tally
      .map((n, i) => {
        if (n === 0) return '';
        const pct = (n / tallied) * 100;
        const color = getAQIColor(US_CATEGORY_SAMPLES[i], 'us').hex;
        const name = getAQICategory(US_CATEGORY_SAMPLES[i], 'us');
        return `<span class="cat-seg" style="flex: ${n}; background: ${color};" title="${name}: ${pct.toFixed(0)}%"></span>`;
      })
      .join('');
    const legend = tally
      .map((n, i) => {
        if (n === 0) return '';
        const color = getAQIColor(US_CATEGORY_SAMPLES[i], 'us').hex;
        const name = getAQICategory(US_CATEGORY_SAMPLES[i], 'us');
        return `<span class="cat-key"><span class="cat-swatch" style="background: ${color};"></span>${name} ${Math.round((n / tallied) * 100)}%</span>`;
      })
      .join('');
    categories = `
      <div class="summary-categories">
        <div class="summary-label">Time in each US AQI category${mode === 'raw' ? ', raw' : ''}</div>
        <div class="cat-bar">${segments}</div>
        <div class="cat-legend">${legend}</div>
      </div>`;
  }

  const expected =
    rows.length > 1
      ? Math.round((rows[rows.length - 1].ts - rows[0].ts) / intervalSeconds(currentInterval)) + 1
      : rows.length;
  const coverage = expected > 0 ? Math.min(100, Math.round((rows.length / expected) * 100)) : 0;
  const filterNote =
    weatherFilter === 'all'
      ? `${coverage}% of ${intervalSeconds(currentInterval) <= 3600 ? 'hours' : 'buckets'} have readings`
      : `Only ${WEATHER_LABELS[weatherFilter].toLowerCase()} hours, ${points.length} of ${rows.length}`;

  host.innerHTML = `
    <div class="summary-blocks">${blocks}</div>
    ${categories}
    <div class="summary-foot">${filterNote}</div>
  `;
}

function renderCalendar(points: Row[]) {
  const target = document.getElementById('extended-dots-grid');
  const subtitle = document.getElementById('extended-dots-subtitle');
  if (!target) return;
  const useRaw = mode === 'raw';
  const mapped = points.map((p) => ({
    ts: p.ts,
    pm2_5: num(p, useRaw ? 'pm2_5_raw' : 'pm2_5'),
    pm10: num(p, useRaw ? 'pm10_raw' : 'pm10'),
  }));
  const usable = mapped.filter((p) => p.pm2_5 !== null || p.pm10 !== null);
  if (usable.length === 0) {
    target.innerHTML =
      '<div class="history-muted">No particulate readings in this selection.</div>';
    if (subtitle) subtitle.textContent = '';
    return;
  }
  renderExtendedDotsGrid(usable, true, true, target, subtitle);
}

function renderWeatherImpact(points: Row[]) {
  const container = document.getElementById('weather-impact');
  const card = document.getElementById('hist-weather-card');
  if (!container || !card) return;

  const key = activeSeries()[0]?.key;
  const groups: { [k: string]: { sum: number; count: number } } = {};
  if (weather && key) {
    rows.forEach((p) => {
      const v = num(p, key);
      const condition = conditionForTs(p.ts);
      if (v === null || condition === null) return;
      if (!groups[condition]) groups[condition] = { sum: 0, count: 0 };
      groups[condition].sum += v;
      groups[condition].count += 1;
    });
  }

  updateWeatherChips(groups);

  let total = 0;
  let count = 0;
  Object.keys(groups).forEach((c) => {
    total += groups[c].sum;
    count += groups[c].count;
  });
  const present = Object.keys(WEATHER_LABELS).filter((c) => groups[c] && groups[c].count >= 3);
  if (count === 0 || present.length < 2) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  const overall = total / count;
  const def = METRICS[metric];
  const unit = def.unit === 'US AQI' ? '' : ` ${def.unit}`;
  const step = weather ? weather.interval : 3600;
  const sub = document.getElementById('hist-weather-sub');
  if (sub) {
    sub.textContent = `Average ${activeSeries()[0].label} under each kind of weather in this range`;
  }

  container.innerHTML = present
    .map((c) => {
      const avg = groups[c].sum / groups[c].count;
      const hours = Math.round((groups[c].count * step) / 3600);
      const diff = Math.round(((avg - overall) / overall) * 100);
      const better = metric === 'temp' || metric === 'humidity' ? null : diff <= 0;
      const color =
        better === null
          ? 'var(--on-surface-variant)'
          : better
            ? 'var(--aqi-good)'
            : 'var(--aqi-poor)';
      const text = diff === 0 ? 'same as average' : `${diff > 0 ? '+' : ''}${diff}% vs average`;
      return `
        <div class="weather-impact-item">
          <div class="summary-label">${WEATHER_LABELS[c]} · ${hours}h</div>
          <div class="weather-impact-value">${fmt(avg)}<span class="summary-unit">${unit}</span></div>
          <div class="summary-note" style="color: ${color};">${text}</div>
        </div>`;
    })
    .join('');
}

function updateWeatherChips(groups: { [k: string]: { sum: number; count: number } }) {
  let activeVisible = weatherFilter === 'all';
  Object.keys(WEATHER_LABELS).forEach((condition) => {
    const btn = document.getElementById(`wf-${condition}`);
    if (!btn) return;
    const present = !!groups[condition] && groups[condition].count > 0;
    btn.style.display = present ? '' : 'none';
    if (present && weatherFilter === condition) activeVisible = true;
  });
  const row = document.getElementById('hist-weather-row');
  if (row) {
    row.classList.toggle('hidden', Object.keys(groups).length < 2);
  }
  if (!activeVisible) {
    weatherFilter = 'all';
    markActive('weather-filter-chips', 'wf-all');
  }
}

function renderRawNote() {
  const note = document.getElementById('hist-raw-note');
  const text = document.getElementById('hist-raw-note-text');
  if (!note || !text) return;
  if (mode === 'cal') {
    note.classList.add('hidden');
    return;
  }
  const keys = METRICS[metric].cal.map(rawKey);
  const first = rows.find((p) => keys.some((k) => num(p, k) !== null));
  let message = '';
  if (!first) {
    message =
      'There are no raw readings stored for this range yet. Breathe only started keeping them recently.';
  } else if (rows.length > 0 && first.ts - rows[0].ts > 2 * intervalSeconds(currentInterval)) {
    const day = new Date(first.ts * 1000).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    message = `Raw readings for this sensor start on ${day}. Earlier parts of the range are blank in raw.`;
  } else {
    message = GENERIC_RAW_NOTE;
  }
  text.textContent = message;
  note.classList.toggle('generic', message === GENERIC_RAW_NOTE);
  note.classList.remove('hidden');
  const points = note.querySelector('.raw-banner-points');
  if (points && !points.innerHTML) {
    points.innerHTML = rawExplainerHtml();
  }
}

function renderAll() {
  clearExtendedSelection();
  const points = filteredRows();
  const empty = document.getElementById('hist-empty');
  if (empty) empty.classList.toggle('hidden', points.length > 0);
  renderRawNote();
  renderSummary(points);
  renderMainChart(points);
  renderCalendar(points);
  renderHourProfile(points);
  renderWeatherImpact(points);
  renderCompare();
}

function markActive(groupId: string, activeId: string | null) {
  document.querySelectorAll(`#${groupId} .btn-outlined`).forEach((btn) => {
    btn.classList.toggle('active', btn.id === activeId);
    btn.setAttribute('aria-pressed', btn.id === activeId ? 'true' : 'false');
  });
}

function setLoading(on: boolean) {
  document.getElementById('view-history')?.classList.toggle('history-loading', on);
}

async function load() {
  if (!historyZone) return;
  requestId += 1;
  const id = requestId;
  setLoading(true);
  const [data, weatherData] = await Promise.all([
    fetchHistoricalData(historyZone.id, currentRange, currentInterval, ALL_METRICS),
    fetchWeatherHistory(historyZone.id, currentRange, currentInterval),
  ]);
  if (id !== requestId) return;
  setLoading(false);
  rows = (data && data.data ? data.data : []).sort((a: Row, b: Row) => a.ts - b.ts);
  weather = weatherData;
  compareRows = {};
  renderAll();
  loadCompare();
}

function showPanel(which: 'date' | 'custom' | null) {
  document.getElementById('hist-date-inputs')?.classList.toggle('hidden', which !== 'date');
  document.getElementById('hist-custom-inputs')?.classList.toggle('hidden', which !== 'custom');
}

function setHistoryRange(range: string) {
  showPanel(null);
  markActive('hist-range-buttons', `hist-${range}`);
  currentRange = range;
  currentInterval = '1h';
  load();
}

function todayDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function renderPeriod() {
  if (!period) return;
  markActive('hist-period-modes', `hist-period-${periodMode}`);
  const today = formatCalendarDate(todayDate());
  const startInput = document.getElementById('hist-date-start') as HTMLInputElement | null;
  const endInput = document.getElementById('hist-date-end') as HTMLInputElement | null;
  const endField = document.getElementById('hist-date-end-field');
  const startLabel = document.getElementById('hist-date-start-label');
  const label = document.getElementById('hist-date-label');
  const nextBtn = document.getElementById('hist-date-next') as HTMLButtonElement | null;

  if (startInput) {
    startInput.max = today;
    startInput.value = formatCalendarDate(period.start);
  }
  if (endInput) {
    endInput.max = today;
    endInput.value = formatCalendarDate(period.end);
  }
  endField?.classList.toggle('hidden', periodMode !== 'days');
  if (startLabel) {
    if (periodMode === 'days') startLabel.innerText = 'From';
    else if (periodMode === 'week') startLabel.innerText = 'Week containing';
    else startLabel.innerText = 'Month containing';
  }
  if (label) label.innerText = historyPeriodLabel(periodMode, period);
  if (nextBtn) {
    const next = shiftHistoryPeriod(periodMode, period, 1);
    nextBtn.disabled = formatCalendarDate(next.start) > today;
  }
}

function applyPeriod() {
  if (!period) return;
  renderPeriod();
  currentRange = historyPeriodToken(period);
  currentInterval = '1h';
  load();
}

function toggleDateRange() {
  markActive('hist-range-buttons', 'hist-date-btn');
  showPanel('date');
  if (!period) {
    period = historyPeriodContaining(periodMode, todayDate());
  }
  applyPeriod();
}

function setHistoryPeriodMode(next: HistoryPeriodMode) {
  const today = todayDate();
  let anchor = period ? period.end : today;
  if (anchor > today) anchor = today;
  periodMode = next;
  period = historyPeriodContaining(next, anchor);
  applyPeriod();
}

function stepHistoryPeriod(direction: number) {
  if (!period) return;
  period = shiftHistoryPeriod(periodMode, period, direction);
  applyPeriod();
}

function onHistoryDateChange() {
  const startInput = document.getElementById('hist-date-start') as HTMLInputElement | null;
  const endInput = document.getElementById('hist-date-end') as HTMLInputElement | null;
  const start = startInput ? parseCalendarDate(startInput.value) : null;
  if (!start) {
    renderPeriod();
    return;
  }
  if (periodMode !== 'days') {
    period = historyPeriodContaining(periodMode, start);
    applyPeriod();
    return;
  }
  const end = endInput ? parseCalendarDate(endInput.value) : null;
  if (!end) {
    renderPeriod();
    return;
  }
  period = start <= end ? { start, end } : { start: end, end: start };
  applyPeriod();
}

function toggleCustomRange() {
  markActive('hist-range-buttons', 'hist-custom-btn');
  showPanel('custom');
}

function applyCustomHistory() {
  const rangeInput = document.getElementById('custom-range') as HTMLInputElement | null;
  const intervalInput = document.getElementById('custom-interval') as HTMLInputElement | null;
  if (!rangeInput || !rangeInput.value) return;
  currentRange = rangeInput.value.trim();
  currentInterval = intervalInput && intervalInput.value ? intervalInput.value.trim() : '1h';
  load();
}

function setHistoryMetric(next: Metric) {
  metric = next;
  markActive('hist-metric-buttons', `hist-metric-${next}`);
  renderAll();
}

function setHistoryMode(next: Mode) {
  mode = next;
  markActive('hist-mode-buttons', `hist-mode-${next}`);
  renderAll();
}

function setWeatherFilter(condition: string) {
  weatherFilter = condition;
  markActive('weather-filter-chips', `wf-${condition}`);
  renderAll();
}

function downloadHistoryCSV() {
  if (!historyZone) return;
  window.open(
    `${API_URL}/historical-data/${encodeURIComponent(historyZone.id)}/${currentRange}/${currentInterval}/${ALL_METRICS}?format=csv`
  );
}

export function openHistoryFor(zone: Zone) {
  if (!historyZone || historyZone.id !== zone.id) {
    compareIds = [];
    compareRows = {};
  }
  historyZone = zone;
  const title = document.getElementById('history-title-header');
  if (title) title.innerText = `${zone.name} History`;
  const line = document.getElementById('history-place-line');
  if (line) line.textContent = placeLine(zone);

  showView('history');
  rows = [];
  weather = null;
  period = null;
  weatherFilter = 'all';
  markActive('weather-filter-chips', 'wf-all');
  mode = isRawMode() ? 'raw' : 'cal';
  markActive('hist-mode-buttons', `hist-mode-${mode}`);
  markActive('hist-metric-buttons', `hist-metric-${metric}`);
  setHistoryRange('1w');
}

export function refreshHistory() {
  if (!historyZone || rows.length === 0) return;
  renderAll();
}

export function syncHistoryRawMode() {
  if (!historyZone) return;
  setHistoryMode(isRawMode() ? 'raw' : 'cal');
}

const COMPARE_COLORS_DARK = [
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];
const COMPARE_COLORS_LIGHT = [
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
];
const COMPARE_MIN_OVERLAP = 24;

let getPlaces: () => Zone[] = () => [];
let compareIds: string[] = [];
let compareRows: { [id: string]: Row[] } = {};
let compareRequest = 0;
let compareChart: LineChart | null = null;

interface PairStats {
  n: number;
  r: number | null;
  ratio: number | null;
  bias: number | null;
  gap: number | null;
}

function comparablePlaces(): Zone[] {
  return getPlaces().filter((p) => !isEstimate(p) && (!historyZone || p.id !== historyZone.id));
}

function compareKey(): string {
  const base = METRICS[metric].cal[0];
  return mode === 'raw' ? rawKey(base) : base;
}

function compareLabel(): string {
  const name = METRICS[metric].names[0];
  return mode === 'raw' ? `${name} raw` : name;
}

function seriesByTs(points: Row[], key: string): Map<number, number> {
  const out = new Map<number, number>();
  points.forEach((p) => {
    const v = num(p, key);
    if (v !== null) {
      out.set(p.ts, v);
    }
  });
  return out;
}

function pairStats(a: Map<number, number>, b: Map<number, number>): PairStats {
  const xs: number[] = [];
  const ys: number[] = [];
  a.forEach((v, ts) => {
    const w = b.get(ts);
    if (w !== undefined) {
      xs.push(v);
      ys.push(w);
    }
  });
  const n = xs.length;
  if (n < 2) {
    return { n, r: null, ratio: null, bias: null, gap: null };
  }
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  let gap = 0;
  const ratios: number[] = [];
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
    syy += (ys[i] - my) * (ys[i] - my);
    gap += Math.abs(ys[i] - xs[i]);
    if (xs[i] > 0) {
      ratios.push(ys[i] / xs[i]);
    }
  }
  ratios.sort((p, q) => p - q);
  const ratio = ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)] : null;
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
  return { n, r, ratio, bias: my - mx, gap: gap / n };
}

function verdict(stats: PairStats): { label: string; tone: 'good' | 'fair' | 'poor' | 'none' } {
  if (stats.n < COMPARE_MIN_OVERLAP || stats.r === null) {
    return { label: 'Not enough overlap', tone: 'none' };
  }
  const levelMatches =
    metric === 'temp' || metric === 'humidity'
      ? stats.gap !== null && stats.gap <= (metric === 'temp' ? 2 : 8)
      : stats.ratio !== null && Math.abs(stats.ratio - 1) <= 0.15;
  if (stats.r >= 0.9 && levelMatches) {
    return { label: 'Very consistent', tone: 'good' };
  }
  if (stats.r >= 0.9) {
    return { label: 'Same pattern, different level', tone: 'fair' };
  }
  if (stats.r >= 0.75) {
    return { label: 'Mostly consistent', tone: 'fair' };
  }
  if (stats.r >= 0.5) {
    return { label: 'Loosely related', tone: 'poor' };
  }
  return { label: 'Inconsistent', tone: 'poor' };
}

function compareColor(index: number): string {
  const dark = getCurrentTheme() === 'dark';
  if (compareIds.length > COMPARE_COLORS_DARK.length) {
    return dark ? 'rgba(196, 199, 208, 0.45)' : 'rgba(82, 81, 78, 0.4)';
  }
  const palette = dark ? COMPARE_COLORS_DARK : COMPARE_COLORS_LIGHT;
  return palette[index % palette.length];
}

function placeName(id: string): string {
  return getPlaces().find((p) => p.id === id)?.name ?? id;
}

function filterLikeBase(points: Row[]): Row[] {
  if (weatherFilter === 'all') {
    return points;
  }
  return points.filter((row) => conditionForTs(row.ts) === weatherFilter);
}

function renderComparePicker() {
  const picker = document.getElementById('hist-compare-picker');
  if (!picker) return;
  const places = comparablePlaces();
  const byDistrict = new Map<string, Zone[]>();
  places.forEach((p) => {
    const key = p.district || 'Other';
    if (!byDistrict.has(key)) byDistrict.set(key, []);
    byDistrict.get(key)!.push(p);
  });
  const districts = Array.from(byDistrict.keys()).sort((a, b) => a.localeCompare(b));
  picker.innerHTML = districts
    .map((district) => {
      const chips = byDistrict
        .get(district)!
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => {
          const on = compareIds.includes(p.id);
          return `<button class="compare-chip${on ? ' active' : ''}" aria-pressed="${on}" onclick="toggleCompare('${p.id}')">${p.name}</button>`;
        })
        .join('');
      return `<div class="compare-group"><span class="compare-group-label">${district}</span>${chips}</div>`;
    })
    .join('');
}

async function loadCompare() {
  if (!historyZone) return;
  compareRequest += 1;
  const request = compareRequest;
  const missing = compareIds.filter((id) => !compareRows[id]);
  if (missing.length > 0) {
    document.getElementById('hist-compare-card')?.classList.add('history-loading-card');
    const results = await Promise.all(
      missing.map((id) => fetchHistoricalData(id, currentRange, currentInterval, ALL_METRICS))
    );
    if (request !== compareRequest) return;
    missing.forEach((id, i) => {
      const data = results[i];
      compareRows[id] = (data && data.data ? data.data : []).sort((a: Row, b: Row) => a.ts - b.ts);
    });
    document.getElementById('hist-compare-card')?.classList.remove('history-loading-card');
  }
  renderCompare();
}

function renderCompareChart(base: Row[]) {
  const canvas = document.getElementById('compareChart') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (compareChart) {
    compareChart.destroy();
    compareChart = null;
  }
  if (!historyZone) return;

  const key = compareKey();
  const bucket = displayBucket(base);
  const grid = new Set<number>();
  const shownBase = aggregate(base, bucket, [key]);
  shownBase.forEach((p) => grid.add(p.ts));
  const shownOthers = compareIds.map((id) => {
    const shown = aggregate(filterLikeBase(compareRows[id] || []), bucket, [key]);
    shown.forEach((p) => grid.add(p.ts));
    return seriesByTs(shown, key);
  });
  const stamps = Array.from(grid).sort((a, b) => a - b);
  const baseMap = seriesByTs(shownBase, key);
  const theme = chartTheme();
  const def = METRICS[metric];
  const dark = getCurrentTheme() === 'dark';
  const many = compareIds.length > COMPARE_COLORS_DARK.length;

  const datasets = compareIds.map((id, i) => ({
    label: placeName(id),
    data: stamps.map((ts) => shownOthers[i].get(ts) ?? null),
    borderColor: compareColor(i),
    backgroundColor: compareColor(i),
    borderWidth: many ? 1.25 : 2,
    tension: 0.3,
    pointRadius: 0,
    pointHoverRadius: 4,
    spanGaps: false,
    fill: false,
    order: 2,
  }));
  datasets.unshift({
    label: historyZone.name,
    data: stamps.map((ts) => baseMap.get(ts) ?? null),
    borderColor: dark ? '#3987e5' : '#2a78d6',
    backgroundColor: dark ? '#3987e5' : '#2a78d6',
    borderWidth: 3,
    tension: 0.3,
    pointRadius: 0,
    pointHoverRadius: 5,
    spanGaps: false,
    fill: false,
    order: 1,
  });

  const config: ChartConfiguration<'line', (number | null)[], string> = {
    type: 'line',
    data: { labels: stamps.map((ts) => timeLabel(ts, bucket)), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: !many,
          position: 'top',
          align: 'start',
          labels: { color: theme.text, usePointStyle: true, pointStyle: 'line', boxWidth: 24 },
        },
        tooltip: {
          itemSort: (a, b) => (Number(b.raw) || 0) - (Number(a.raw) || 0),
          filter: (item) => typeof item.raw === 'number',
          callbacks: {
            label: (c) => {
              const value = typeof c.raw === 'number' ? c.raw : null;
              return `${c.dataset.label}  ${fmt(value)} ${def.unit === 'US AQI' ? '' : def.unit}`.trim();
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: theme.tick,
            maxTicksLimit: window.innerWidth < 600 ? 4 : 7,
            maxRotation: 0,
            font: { size: 11 },
          },
        },
        y: {
          beginAtZero: metric !== 'temp',
          position: 'right',
          border: { display: false },
          grid: { color: theme.grid },
          ticks: { color: theme.tick, maxTicksLimit: 6, font: { size: 11 } },
        },
      },
    },
    plugins: [categoryBands],
  };
  compareChart = new Chart(ctx, config);
}

function toneColor(tone: string): string {
  if (tone === 'good') return 'var(--aqi-good)';
  if (tone === 'fair') return 'var(--us-aqi-moderate)';
  if (tone === 'poor') return 'var(--us-aqi-sensitive)';
  return 'var(--on-surface-variant)';
}

function renderCompareStats(base: Row[]) {
  const host = document.getElementById('hist-compare-stats');
  const summary = document.getElementById('hist-compare-summary');
  if (!host || !summary || !historyZone) return;
  const key = compareKey();
  const baseMap = seriesByTs(base, key);
  const unit = METRICS[metric].unit === 'US AQI' ? '' : ` ${METRICS[metric].unit}`;

  const rowsHtml = compareIds
    .map((id) => {
      const stats = pairStats(baseMap, seriesByTs(filterLikeBase(compareRows[id] || []), key));
      return { id, stats, v: verdict(stats) };
    })
    .sort((a, b) => (b.stats.r ?? -2) - (a.stats.r ?? -2));

  const good = rowsHtml.filter((x) => x.v.tone === 'good').length;
  const counted = rowsHtml.filter((x) => x.v.tone !== 'none').length;
  summary.textContent =
    counted === 0
      ? `Not enough overlapping ${compareLabel()} readings in this range to judge.`
      : `${good} of ${counted} sensor${counted === 1 ? '' : 's'} track ${historyZone.name} closely on ${compareLabel()}.`;

  host.innerHTML = `
    <div class="table-scroll">
      <table class="compare-table">
        <thead><tr><th>Sensor</th><th>Agreement</th><th title="How closely they rise and fall together, from 0 to 1">Moves together</th><th title="Their reading divided by this one's, middle value">Typical ratio</th><th title="Average size of the difference">Typical gap</th><th>Hours</th></tr></thead>
        <tbody>
          ${rowsHtml
            .map(({ id, stats, v }) => {
              const color = compareColor(compareIds.indexOf(id));
              return `<tr>
                <td><span class="compare-swatch" style="background: ${color};"></span>${placeName(id)}</td>
                <td style="color: ${toneColor(v.tone)};">${v.label}</td>
                <td>${stats.r === null ? '--' : stats.r.toFixed(2)}</td>
                <td>${stats.ratio === null ? '--' : `${stats.ratio.toFixed(2)}×`}</td>
                <td>${stats.gap === null ? '--' : `${fmt(stats.gap)}${unit}`}</td>
                <td>${stats.n}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
    <p class="compare-note">Moves together is the correlation: 1 means they rise and fall at exactly the same times, 0 means no link at all. Typical ratio is their reading over ${historyZone.name}'s, so 1.20× means they usually read 20% higher. Typical gap is how far apart the two readings are on average. A pair can move together closely and still sit at different levels, which usually means one sensor reads high or low rather than the air being different.</p>
  `;
}

function renderCompareMatrix(base: Row[]) {
  const host = document.getElementById('hist-compare-matrix');
  if (!host || !historyZone) return;
  if (compareIds.length < 2) {
    host.innerHTML = '';
    return;
  }
  const key = compareKey();
  const ids = [historyZone.id, ...compareIds];
  const maps = ids.map((id, i) =>
    seriesByTs(i === 0 ? base : filterLikeBase(compareRows[id] || []), key)
  );
  const names = ids.map((id, i) => (i === 0 ? historyZone!.name : placeName(id)));
  const dark = getCurrentTheme() === 'dark';
  const cell = (r: number | null) => {
    if (r === null) return '<td class="matrix-empty">--</td>';
    const strength = Math.max(0, Math.min(1, r));
    const bg = dark
      ? `rgba(57, 135, 229, ${0.08 + strength * 0.7})`
      : `rgba(42, 120, 214, ${0.06 + strength * 0.6})`;
    const fg = strength > 0.6 ? '#ffffff' : 'var(--on-surface)';
    return `<td style="background: ${bg}; color: ${fg};">${r.toFixed(2)}</td>`;
  };
  const body = ids
    .map((_, i) => {
      const cells = ids
        .map((__, j) => {
          if (i === j) return '<td class="matrix-self"></td>';
          const s = pairStats(maps[i], maps[j]);
          return cell(s.n >= COMPARE_MIN_OVERLAP ? s.r : null);
        })
        .join('');
      return `<tr><th>${names[i]}</th>${cells}</tr>`;
    })
    .join('');
  host.innerHTML = `
    <h4 class="compare-subhead">Every pair</h4>
    <p class="compare-note">How closely each pair moves together on ${compareLabel()}, from 0 to 1. Darker means more consistent.</p>
    <div class="table-scroll">
      <table class="compare-matrix">
        <thead><tr><th></th>${names.map((n) => `<th><span>${n}</span></th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderCompare() {
  const card = document.getElementById('hist-compare-card');
  const results = document.getElementById('hist-compare-results');
  const sub = document.getElementById('hist-compare-sub');
  if (!card || !results) return;
  renderComparePicker();
  if (sub) {
    sub.textContent = `Overlay ${compareLabel()} from other sensors on ${historyZone ? historyZone.name : 'this one'} for the same range`;
  }
  const hasSelection = compareIds.length > 0;
  results.classList.toggle('hidden', !hasSelection);
  if (!hasSelection) {
    if (compareChart) {
      compareChart.destroy();
      compareChart = null;
    }
    return;
  }
  const base = filteredRows();
  renderCompareChart(base);
  renderCompareStats(base);
  renderCompareMatrix(base);
}

function toggleCompare(id: string) {
  if (compareIds.includes(id)) {
    compareIds = compareIds.filter((x) => x !== id);
  } else {
    compareIds = [...compareIds, id];
  }
  loadCompare();
}

function compareAll() {
  compareIds = comparablePlaces().map((p) => p.id);
  loadCompare();
}

function compareDistrict() {
  const district = historyZone?.district;
  compareIds = comparablePlaces()
    .filter((p) => p.district === district)
    .map((p) => p.id);
  loadCompare();
}

function clearCompare() {
  compareIds = [];
  renderCompare();
}

(window as any).toggleCompare = toggleCompare;
(window as any).compareAll = compareAll;
(window as any).compareDistrict = compareDistrict;
(window as any).clearCompare = clearCompare;

(window as any).setHistoryRange = setHistoryRange;
(window as any).toggleDateRange = toggleDateRange;
(window as any).toggleCustomRange = toggleCustomRange;
(window as any).setHistoryPeriodMode = setHistoryPeriodMode;
(window as any).stepHistoryPeriod = stepHistoryPeriod;
(window as any).onHistoryDateChange = onHistoryDateChange;
(window as any).applyCustomHistory = applyCustomHistory;
(window as any).setHistoryMetric = setHistoryMetric;
(window as any).setHistoryMode = setHistoryMode;
(window as any).setWeatherFilter = setWeatherFilter;
(window as any).downloadHistoryCSV = downloadHistoryCSV;
