import { fetchForecast, fetchForecastRecord } from './api.js';
import { STORAGE_KEY_FORECAST } from './config.js';
import { Forecast, ForecastPoint, ForecastTrackRecord, Zone } from './types.js';
import {
  aqiTextColor,
  getAQICategory,
  getAQIColor,
  getAQIStandard,
  getCurrentTheme,
  pm25ToAqi,
} from './utils.js';
import { isEstimate } from './readings.js';
import type { Chart as ChartJS, ChartConfiguration } from 'chart.js';

declare const Chart: typeof ChartJS;
type AnyChart = InstanceType<typeof Chart>;

const FORECAST_CITIES = ['jammu_city', 'srinagar'];
const SHOWN_HORIZONS = [60, 180, 360, 720];
const RECORD_MODAL = 'forecast-record-modal';

const requests: { [targetId: string]: number } = {};
const cardCharts: { [targetId: string]: AnyChart } = {};

let recordCity: string | null = null;
let recordDays = 7;
let recordHorizon = 180;
let recordRequest = 0;
let recordCharts: AnyChart[] = [];

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
  if (!zone || isEstimate(zone)) {
    return null;
  }
  const city = zone.legacy_zone || zone.id;
  if (!FORECAST_CITIES.includes(city)) {
    return null;
  }
  return city;
}

export function percent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) {
    return '--';
  }
  return `${Math.round(rate * 100)}%`;
}

export function changeText(from: number, to: number): string {
  const diff = Math.round(to - from);
  if (Math.abs(diff) < 2) {
    return 'about the same';
  }
  if (diff > 0) {
    return `↑ ${diff}`;
  }
  return `↓ ${Math.abs(diff)}`;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function clockTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function clockHour(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric' });
}

function shortDay(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function pointAqi(point: ForecastPoint): number {
  if (getAQIStandard() === 'us') {
    return point.us_aqi;
  }
  return point.aqi;
}

function rowHtml(point: ForecastPoint, current: number): string {
  const std = getAQIStandard();
  const aqi = pointAqi(point);
  const color = getAQIColor(aqi, std).hex;
  return `
    <div class="forecast-row">
      <div class="forecast-row-when">
        <span class="forecast-row-time">${clockTime(point.ts)}</span>
        <span class="forecast-row-in">in ${point.horizon_minutes / 60}h</span>
      </div>
      <div class="forecast-row-category">${getAQICategory(aqi, std)}</div>
      <div class="forecast-row-pm">
        <span class="forecast-row-value">${Math.round(point.pm2_5)}</span>
        <span class="forecast-row-unit">µg/m³</span>
        <span class="forecast-row-change">${changeText(current, point.pm2_5)}</span>
      </div>
      <span class="forecast-row-aqi right-now-aqi" title="${getAQICategory(aqi, std)}" style="background: ${color}; color: ${aqiTextColor(aqi, std)};">${aqi}</span>
    </div>
  `;
}

function recordLineHtml(record: ForecastTrackRecord | null, city: string): string {
  if (!record || record.overall.right_rate === null) {
    return '';
  }
  return `
    <button class="forecast-record-link" onclick="openForecastRecord('${city}')">
      <span class="forecast-record-text">
        <span class="forecast-record-main">Right ${percent(record.overall.right_rate)} of the time this week</span>
        <span class="forecast-record-sub">Just repeating the current reading got ${percent(record.overall.persistence_right_rate)}</span>
      </span>
      <svg class="settings-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" /></svg>
    </button>
  `;
}

export function forecastCardHtml(
  forecast: Forecast,
  zone: Zone,
  record: ForecastTrackRecord | null,
  chartId: string
): string {
  const rows = forecast.points
    .filter((point) => SHOWN_HORIZONS.includes(point.horizon_minutes))
    .map((point) => rowHtml(point, forecast.current.pm2_5))
    .join('');
  let scope = `${forecast.zone_name} average`;
  if (zone.id !== forecast.zone_id) {
    scope = `${forecast.zone_name} average, not just this sensor`;
  }
  return `
    <div class="forecast-head">
      <div class="forecast-title">Forecast <span class="forecast-tag">Experimental</span></div>
      <div class="forecast-sub">${scope} · from ${clockTime(forecast.issued_at)}</div>
    </div>
    <div class="forecast-chart-legend">
      <span><i class="forecast-key forecast-key-past"></i>Measured</span>
      <span><i class="forecast-key forecast-key-next"></i>Forecast</span>
      <span class="forecast-chart-unit">PM<sub>2.5</sub> µg/m³</span>
    </div>
    <div class="forecast-chart"><canvas id="${chartId}"></canvas></div>
    <div class="forecast-rows">${rows}</div>
    ${recordLineHtml(record, forecast.zone_id)}
    <p class="forecast-note">Blends the latest reading with the same hour yesterday. It can't see rain or wind coming, so treat it as a rough guide.</p>
  `;
}

function chartColors() {
  const isDark = getCurrentTheme() === 'dark';
  return {
    tick: isDark ? '#9aa0aa' : '#64748b',
    grid: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
    past: cssVar('--on-surface-variant') || '#c4c6d0',
    next: cssVar('--primary') || '#aac7ff',
    wrong: cssVar('--error') || '#ffb4ab',
    muted: cssVar('--outline-variant') || '#44474e',
  };
}

function drawCardChart(targetId: string, chartId: string, forecast: Forecast): void {
  const canvas = document.getElementById(chartId) as HTMLCanvasElement | null;
  if (cardCharts[targetId]) {
    cardCharts[targetId].destroy();
    delete cardCharts[targetId];
  }
  if (!canvas || typeof Chart === 'undefined') {
    return;
  }
  const colors = chartColors();
  const std = getAQIStandard();
  const now = forecast.issued_at;
  const past = (forecast.recent || []).map((hour) => ({ x: hour.ts, y: hour.pm2_5 }));
  past.push({ x: now, y: forecast.current.pm2_5 });
  const ahead = forecast.points.filter((point) => point.horizon_minutes <= 720);
  const next = [{ x: now, y: forecast.current.pm2_5 }].concat(
    ahead.map((point) => ({ x: point.ts, y: point.pm2_5 }))
  );
  const nextColors = [colors.next].concat(
    ahead.map((point) => getAQIColor(pm25ToAqi(point.pm2_5, std), std).hex)
  );
  const nextRadius = [0].concat(
    ahead.map((point) => (SHOWN_HORIZONS.includes(point.horizon_minutes) ? 4 : 0))
  );
  const highest = Math.max(...past.map((p) => p.y), ...next.map((p) => p.y));
  const top = Math.ceil((highest * 1.1) / 25) * 25;

  const config: ChartConfiguration<'line', { x: number; y: number }[]> = {
    type: 'line',
    data: {
      datasets: [
        {
          data: past,
          borderColor: colors.past,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
        },
        {
          data: next,
          borderColor: colors.next,
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: nextRadius,
          pointBackgroundColor: nextColors,
          pointBorderColor: nextColors,
          tension: 0.3,
        },
        {
          data: [
            { x: now, y: 0 },
            { x: now, y: top },
          ],
          borderColor: colors.muted,
          borderWidth: 1,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          filter: (item) => item.datasetIndex !== 2,
          callbacks: {
            title: (items) => clockTime(Number(items[0].parsed.x)),
            label: (item) => {
              const value = Number(item.parsed.y) || 0;
              const kind = item.datasetIndex === 0 ? 'Measured' : 'Forecast';
              return `${kind} ${value.toFixed(0)} µg/m³`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: past.length ? past[0].x : now - 12 * 3600,
          max: now + 12 * 3600,
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: colors.tick,
            maxTicksLimit: 6,
            maxRotation: 0,
            font: { size: 10 },
            callback: (value) => (Number(value) === now ? 'Now' : clockHour(Number(value))),
          },
          afterBuildTicks: (axis) => {
            const ticks = [];
            for (let h = -12; h <= 12; h += 6) {
              ticks.push({ value: now + h * 3600 });
            }
            axis.ticks = ticks;
          },
        },
        y: {
          beginAtZero: true,
          max: top,
          position: 'right',
          border: { display: false },
          grid: { color: colors.grid },
          ticks: { color: colors.tick, maxTicksLimit: 4, font: { size: 10 } },
        },
      },
    },
  };
  cardCharts[targetId] = new Chart(canvas, config as ChartConfiguration);
}

function hideTarget(target: HTMLElement, targetId: string): void {
  if (cardCharts[targetId]) {
    cardCharts[targetId].destroy();
    delete cardCharts[targetId];
  }
  target.innerHTML = '';
  target.classList.add('hidden');
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
    hideTarget(target, targetId);
    return;
  }

  const [forecast, record] = await Promise.all([fetchForecast(city), fetchForecastRecord(city, 7)]);
  if (requests[targetId] !== request) {
    return;
  }
  if (!forecast || !forecast.points || forecast.points.length === 0) {
    hideTarget(target, targetId);
    return;
  }
  const chartId = `${targetId}-chart`;
  target.innerHTML = forecastCardHtml(forecast, zone, record, chartId);
  target.classList.remove('hidden');
  drawCardChart(targetId, chartId, forecast);
}

function destroyRecordCharts(): void {
  recordCharts.forEach((chart) => chart.destroy());
  recordCharts = [];
}

function horizonRowsHtml(record: ForecastTrackRecord): string {
  return record.horizons
    .map((h) => {
      const width = Math.round((h.right_rate || 0) * 100);
      const miss = h.mean_miss_pm2_5 === null ? '--' : Math.round(h.mean_miss_pm2_5);
      return `
        <div class="record-horizon">
          <div class="record-horizon-top">
            <span class="record-horizon-name">${h.horizon_minutes / 60}h ahead</span>
            <span class="record-horizon-rate">${percent(h.right_rate)}</span>
          </div>
          <div class="record-bar"><div class="record-bar-fill" style="width: ${width}%;"></div></div>
          <div class="record-horizon-sub">${h.right.toLocaleString()} of ${h.forecasts.toLocaleString()} right · repeating now got ${percent(h.persistence_right_rate)} · off by ${miss} µg/m³ on average</div>
        </div>
      `;
    })
    .join('');
}

function recordBodyHtml(record: ForecastTrackRecord): string {
  const overall = record.overall;
  const wrong = overall.forecasts - overall.right;
  const dayButtons = [7, 30]
    .map(
      (d) =>
        `<button class="btn-outlined btn-small${recordDays === d ? ' active' : ''}" onclick="setForecastRecordDays(${d})">${d} days</button>`
    )
    .join('');
  const horizonButtons = SHOWN_HORIZONS.map(
    (h) =>
      `<button class="btn-outlined btn-small${recordHorizon === h ? ' active' : ''}" onclick="setForecastRecordHorizon(${h})">${h / 60}h</button>`
  ).join('');
  return `
    <div class="record-head">
      <div>
        <h3>How the forecast did</h3>
        <div class="forecast-sub">${record.zone_name} average · ${shortDay(record.from)} to ${shortDay(record.to)}</div>
      </div>
      <div class="toggle-group" role="group" aria-label="Period">${dayButtons}</div>
    </div>
    <div class="record-hero">
      <div class="record-hero-rate">${percent(overall.right_rate)}</div>
      <div class="record-hero-text">
        <strong>${overall.right.toLocaleString()} right, ${wrong.toLocaleString()} wrong</strong>
        <span>A forecast counts as right when it landed in the same AQI category as what happened. Just repeating the current reading would have been right ${percent(overall.persistence_right_rate)} of the time.</span>
      </div>
    </div>
    <div class="record-section-title">By day</div>
    <div class="record-chart record-chart-days"><canvas id="record-days-chart"></canvas></div>
    <div class="record-section-title">By how far ahead</div>
    <div class="record-horizons">${horizonRowsHtml(record)}</div>
    <div class="record-section-head">
      <div class="record-section-title">Forecast against what happened</div>
      <div class="toggle-group" role="group" aria-label="How far ahead">${horizonButtons}</div>
    </div>
    <div class="forecast-chart-legend">
      <span><i class="forecast-key forecast-key-past"></i>Measured</span>
      <span><i class="forecast-key forecast-key-next"></i>Forecast ${recordHorizon / 60}h earlier</span>
      <span><i class="forecast-key forecast-key-wrong"></i>Wrong category</span>
    </div>
    <div class="record-chart"><canvas id="record-series-chart"></canvas></div>
    <p class="forecast-note">Replayed from stored readings with the same frozen model the live forecast uses. It only ever looks at readings from before each forecast time.</p>
  `;
}

function drawRecordCharts(record: ForecastTrackRecord): void {
  destroyRecordCharts();
  if (typeof Chart === 'undefined') {
    return;
  }
  const colors = chartColors();

  const daysCanvas = document.getElementById('record-days-chart') as HTMLCanvasElement | null;
  if (daysCanvas) {
    const labels = record.daily.map((d) =>
      new Date(`${d.date}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })
    );
    const config: ChartConfiguration<'bar', number[], string> = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Right',
            data: record.daily.map((d) => d.right),
            backgroundColor: colors.next,
            borderRadius: 3,
            stack: 'day',
          },
          {
            label: 'Wrong',
            data: record.daily.map((d) => d.forecasts - d.right),
            backgroundColor: colors.muted,
            borderRadius: 3,
            stack: 'day',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              footer: (items) => {
                const day = record.daily[items[0].dataIndex];
                return `${percent(day.right_rate)} right`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            border: { display: false },
            ticks: { color: colors.tick, maxTicksLimit: 8, maxRotation: 0, font: { size: 10 } },
          },
          y: {
            stacked: true,
            position: 'right',
            border: { display: false },
            grid: { color: colors.grid },
            ticks: { color: colors.tick, maxTicksLimit: 4, font: { size: 10 } },
          },
        },
      },
    };
    recordCharts.push(new Chart(daysCanvas, config as ChartConfiguration));
  }

  const seriesCanvas = document.getElementById('record-series-chart') as HTMLCanvasElement | null;
  const series = record.series[String(recordHorizon)] || [];
  if (seriesCanvas && series.length > 0) {
    const config: ChartConfiguration<'line', { x: number; y: number }[]> = {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Measured',
            data: series.map((p) => ({ x: p.ts, y: p.actual_pm2_5 })),
            borderColor: colors.past,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.25,
          },
          {
            label: 'Forecast',
            data: series.map((p) => ({ x: p.ts, y: p.forecast_pm2_5 })),
            borderColor: colors.next,
            borderWidth: 1.5,
            borderDash: [5, 3],
            pointRadius: series.map((p) => (p.right ? 0 : 2.5)),
            pointBackgroundColor: colors.wrong,
            pointBorderColor: colors.wrong,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const ts = Number(items[0].parsed.x);
                return `${shortDay(ts)} ${clockTime(ts)}`;
              },
              label: (item) => `${item.dataset.label} ${Number(item.parsed.y).toFixed(0)} µg/m³`,
              footer: (items) => (series[items[0].dataIndex].right ? 'Right category' : 'Wrong category'),
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: series[0].ts,
            max: series[series.length - 1].ts,
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: colors.tick,
              maxTicksLimit: 6,
              maxRotation: 0,
              font: { size: 10 },
              callback: (value) => shortDay(Number(value)),
            },
          },
          y: {
            beginAtZero: true,
            position: 'right',
            border: { display: false },
            grid: { color: colors.grid },
            ticks: { color: colors.tick, maxTicksLimit: 4, font: { size: 10 } },
          },
        },
      },
    };
    recordCharts.push(new Chart(seriesCanvas, config as ChartConfiguration));
  }
}

async function renderRecord(): Promise<void> {
  const body = document.getElementById('forecast-record-body');
  if (!body || !recordCity) {
    return;
  }
  const request = ++recordRequest;
  if (!body.innerHTML.trim()) {
    body.innerHTML = '<div class="skeleton-line" style="height: 240px; border-radius: 12px;"></div>';
  }
  const record = await fetchForecastRecord(recordCity, recordDays);
  if (request !== recordRequest) {
    return;
  }
  if (!record || record.overall.forecasts === 0) {
    destroyRecordCharts();
    body.innerHTML = '<p class="forecast-note">No track record yet for this period.</p>';
    return;
  }
  body.innerHTML = recordBodyHtml(record);
  drawRecordCharts(record);
}

export function openForecastRecord(city: string): void {
  recordCity = city;
  const body = document.getElementById('forecast-record-body');
  if (body) {
    body.innerHTML = '';
  }
  document.getElementById(RECORD_MODAL)?.classList.remove('hidden');
  renderRecord();
}

export function closeForecastRecord(): void {
  document.getElementById(RECORD_MODAL)?.classList.add('hidden');
  destroyRecordCharts();
}

export function setForecastRecordDays(days: number): void {
  recordDays = days;
  renderRecord();
}

export function setForecastRecordHorizon(horizon: number): void {
  recordHorizon = horizon;
  renderRecord();
}
