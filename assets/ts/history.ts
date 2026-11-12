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
import { isRawMode, placeLine, rawExplainerHtml } from './readings.js';
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

export function initHistory(show: (name: string) => void) {
  showView = show;
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
            maxTicksLimit: 7,
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
    message = "Showing the sensor's uncorrected readings.";
  }
  text.textContent = message;
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
  renderAll();
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
