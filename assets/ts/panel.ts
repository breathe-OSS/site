import { fetchHistoricalData } from './api.js';
import { STORAGE_KEY_PINS } from './config.js';
import { Zone, AQIData, AQIHistory } from './types.js';
import {
  aqiTextColor,
  calculateCigarettes,
  formatPollutantName,
  getAQICategory,
  getAQIColor,
  getAQIStandard,
  getCurrentTheme,
  pm25ToAqi,
  showSnackbar,
  animateCount,
} from './utils.js';
import {
  getPinIconStack,
  hexToRgba,
  renderExtendedDotsGrid,
  renderHealthAdviceCard,
  updateTrendBadge,
  whoRatioColor,
} from './ui.js';
import {
  historyPm25,
  isEstimate,
  isRawMode,
  placeLine,
  rawApplies,
  zoneAqi,
  zoneAverages,
  zoneConcentrations,
  zoneMainPollutant,
} from './readings.js';
import type { Chart as ChartJS, ChartConfiguration } from 'chart.js';

declare const Chart: typeof ChartJS;
type BarChart = InstanceType<typeof Chart<'bar', number[], string>>;

const ABOUT_URL = 'https://about.breatheoss.app';
const WHO_PM25_24H = 15;

type PanelRange = '24h' | '30d' | '180d';

let panelZone: Zone | null = null;
let panelData: AQIData | null = null;
let panelRange: PanelRange = '24h';
let panelChart: BarChart | null = null;
let panelRequest = 0;

export function getPanelZoneId(): string | null {
  return panelZone ? panelZone.id : null;
}

function readPins(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_PINS) || '[]');
  } catch (e) {
    return [];
  }
}

function displayAqi(data: AQIData): number {
  return zoneAqi(data);
}

function minutesAgoText(timestampUnix: number): string {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - timestampUnix) / 60));
  if (minutes < 1) {
    return 'Updated just now';
  }
  if (minutes < 60) {
    return `Updated ${minutes}m ago`;
  }
  return `Updated ${Math.round(minutes / 60)}h ago`;
}

function averagePm25(entries: AQIHistory[]): number | null {
  let sum = 0;
  let count = 0;
  entries.forEach((entry) => {
    const value = historyPm25(entry);
    if (value !== null) {
      sum += value;
      count += 1;
    }
  });
  if (count === 0) {
    return null;
  }
  return sum / count;
}

function sortedHistory(data: AQIData): AQIHistory[] {
  return [...(data.history || [])].sort((a, b) => a.ts - b.ts);
}

function pillHtml(label: string, pm25: number | null): string {
  if (pm25 === null) {
    return '';
  }
  const std = getAQIStandard();
  const aqi = pm25ToAqi(pm25, std);
  const color = getAQIColor(aqi, std).hex;
  return `
    <div class="panel-pill" style="background: ${color}; color: ${aqiTextColor(aqi, std)};">
      <span class="panel-pill-value">${pm25.toFixed(1)} µg/m³</span>
      <span class="panel-pill-label">${label}</span>
    </div>
  `;
}

function headerHtml(zone: Zone, data: AQIData, pinned: boolean): string {
  let source = '<span class="live-dot"></span>Live ground sensor';
  if (isEstimate(zone)) {
    source = 'Satellite estimate, no sensor here yet';
  } else if (data.source && data.source.startsWith('openmeteo')) {
    source = 'Sensor offline, showing a satellite estimate';
  } else if (rawApplies(data)) {
    source += ' · raw readings';
  }
  const line = placeLine(zone);
  return `
    <div class="panel-header">
      <div class="panel-title-block">
        <h2 class="panel-title">${zone.name}</h2>
        ${line ? `<div class="panel-place">${line}</div>` : ''}
        <div class="panel-source">${source}</div>
      </div>
      <div class="panel-actions">
        <button class="panel-icon-btn${pinned ? ' pinned' : ''}" id="panel-pin-btn" aria-label="${pinned ? 'Unpin' : 'Pin'} ${zone.name}" onclick="toggleMapSheetPin()">
          ${getPinIconStack(pinned, true)}
        </button>
        <button class="panel-icon-btn" aria-label="Share ${zone.name}" onclick="sharePanelZone()">
          <svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
        </button>
        <button class="panel-icon-btn" aria-label="Close" onclick="closeMapDetailSheet()">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    </div>
  `;
}

function heroHtml(data: AQIData): string {
  const std = getAQIStandard();
  const aqi = displayAqi(data);
  const color = getAQIColor(aqi, std).hex;
  const pm25 = zoneConcentrations(data)['pm2_5'];
  const chipLabel = `${rawApplies(data) ? 'Raw ' : ''}${std === 'us' ? 'US AQI' : 'NAQI'}`;
  return `
    <div class="panel-hero" style="--aqi-color: ${color};">
      <div class="panel-hero-top">
        <div>
          <div class="panel-category" style="color: ${color};">${getAQICategory(aqi, std)}</div>
          <div class="panel-updated">${minutesAgoText(data.timestamp_unix)}</div>
        </div>
        <div class="panel-aqi-block">
          <div class="panel-aqi" id="panel-aqi" style="color: ${color};">0</div>
          <div class="panel-aqi-chip" style="background: ${color}; color: ${aqiTextColor(aqi, std)};">${chipLabel}</div>
        </div>
      </div>
      <div class="panel-hero-bottom">
        <span>Main pollutant <strong>${formatPollutantName(zoneMainPollutant(data))}</strong></span>
        ${pm25 !== undefined ? `<span>PM<sub>2.5</sub> <strong>${pm25} µg/m³</strong></span>` : ''}
        <span id="panel-trend"></span>
      </div>
    </div>
  `;
}

function chartCardHtml(isLive: boolean): string {
  const toggle = isLive
    ? `
      <div class="toggle-group panel-range" role="group" aria-label="Time range">
        <button class="btn-outlined btn-small${panelRange === '24h' ? ' active' : ''}" onclick="setPanelRange('24h')">24h</button>
        <button class="btn-outlined btn-small${panelRange === '30d' ? ' active' : ''}" onclick="setPanelRange('30d')">30d</button>
        <button class="btn-outlined btn-small${panelRange === '180d' ? ' active' : ''}" onclick="setPanelRange('180d')">180d</button>
      </div>
    `
    : '';
  return `
    <div class="panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">PM<sub>2.5</sub></div>
          <div class="panel-card-sub" id="panel-chart-sub">µg/m³, hourly</div>
        </div>
        ${toggle}
      </div>
      <div class="panel-chart"><canvas id="panel-chart"></canvas></div>
      <div class="panel-pills" id="panel-pills"></div>
    </div>
  `;
}

function statTilesHtml(data: AQIData): string {
  const averages = zoneAverages(data);
  const pm25 = (averages && averages['pm2_5']) || zoneConcentrations(data)['pm2_5'] || 0;
  if (!pm25) {
    return '';
  }
  const cigs = calculateCigarettes(pm25);
  const ratio = pm25 / WHO_PM25_24H;
  const whoColor = whoRatioColor(ratio);
  const whoText = ratio <= 1 ? 'Within' : `${ratio.toFixed(1)}×`;
  return `
    <div class="panel-tiles">
      <div class="panel-tile">
        <div class="panel-tile-label">Cigarettes today</div>
        <div class="panel-tile-value">${cigs}</div>
        <div class="panel-tile-note">What breathing this air for a day adds up to, from the 24 hour PM<sub>2.5</sub> average</div>
      </div>
      <div class="panel-tile">
        <div class="panel-tile-label">WHO guideline</div>
        <div class="panel-tile-value" style="color: ${whoColor};">${whoText}</div>
        <div class="panel-tile-note">24 hour average ${pm25.toFixed(1)} µg/m³ against the WHO limit of ${WHO_PM25_24H} µg/m³</div>
      </div>
    </div>
  `;
}

function gridCardHtml(): string {
  return `
    <div class="panel-card">
      <div class="panel-card-title">Last 10 days by hour</div>
      <div class="panel-card-sub">Each square is one hour, tap for the reading</div>
      <div class="panel-grid" id="panel-grid">
        <div class="skeleton-line" style="height: 120px; border-radius: 12px;"></div>
      </div>
    </div>
  `;
}

function sourceHtml(zone: Zone, data: AQIData, isLive: boolean): string {
  if (isLive) {
    const offline = !!data.source && data.source.startsWith('openmeteo');
    const body = offline
      ? `This BreatheOSS AirGradient sensor isn't reporting right now, so these numbers are a CAMS estimate for its location, served through Open-Meteo.`
      : `PM<sub>2.5</sub> and PM<sub>10</sub> come from this BreatheOSS AirGradient sensor${zone.district ? ` in the ${zone.district} district` : ''}. Gases come from CAMS through Open-Meteo.${rawApplies(data) ? " You are seeing its raw readings, before AirGradient's correction." : ''}`;
    return `
      <div class="panel-card panel-source-card">
        <div class="panel-card-title">Where this comes from</div>
        <p>${body}</p>
      </div>
    `;
  }
  return `
    <div class="panel-card panel-source-card">
      <div class="panel-card-title">Where this comes from</div>
      <p>There's no ground sensor in ${zone.name} yet. These numbers are modelled by CAMS and served through Open-Meteo, so they can miss local smoke and dust.</p>
      <a class="btn-filled panel-link-btn" href="${ABOUT_URL}/#help" target="_blank" rel="noopener">Host a sensor here</a>
    </div>
  `;
}

function contributeHtml(): string {
  return `
    <div class="panel-card panel-contribute">
      <div class="panel-contribute-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
      </div>
      <div class="panel-card-title">Become a contributor</div>
      <p>Host a sensor for free, send code, or help fund the network. Every new sensor puts a real reading where there was only a model before.</p>
      <div class="panel-contribute-links">
        <a class="btn-filled panel-link-btn" href="${ABOUT_URL}/#help" target="_blank" rel="noopener">Help expand the network</a>
        <a class="btn-outlined panel-link-btn" href="${ABOUT_URL}/#contribute" target="_blank" rel="noopener">Other ways to help</a>
      </div>
    </div>
  `;
}

function renderPanel() {
  const body = document.getElementById('zone-panel-body');
  if (!body || !panelZone || !panelData) {
    return;
  }
  const zone = panelZone;
  const data = panelData;
  const std = getAQIStandard();
  const isLive = !isEstimate(zone);
  if (!isLive) {
    panelRange = '24h';
  }
  const pinned = readPins().includes(zone.id);

  body.innerHTML = `
    ${headerHtml(zone, data, pinned)}
    <div class="panel-content">
      ${heroHtml(data)}
      ${renderHealthAdviceCard(displayAqi(data), std)}
      ${chartCardHtml(isLive)}
      ${statTilesHtml(data)}
      ${isLive ? gridCardHtml() : ''}
      ${sourceHtml(zone, data, isLive)}
      ${contributeHtml()}
      <button class="btn-outlined panel-full-btn" onclick="openFullDetails()">Open full details</button>
    </div>
  `;

  const aqiEl = document.getElementById('panel-aqi');
  if (aqiEl) {
    animateCount(aqiEl, displayAqi(data));
  }
  const trendEl = document.getElementById('panel-trend');
  if (trendEl) {
    updateTrendBadge(trendEl, displayAqi(data), data.timestamp_unix, data.history);
  }

  renderPanelChart();
  if (isLive) {
    renderPanelGrid(zone.id);
  }
}

async function renderPanelGrid(zoneId: string) {
  const request = panelRequest;
  const raw = isRawMode();
  const result = await fetchHistoricalData(
    zoneId,
    '9d',
    '1h',
    raw ? 'pm2.5,pm10,pm2.5_raw,pm10_raw' : 'pm2.5,pm10'
  );
  if (request !== panelRequest) {
    return;
  }
  const target = document.getElementById('panel-grid');
  if (!target) {
    return;
  }
  const fetched: { ts: number; [key: string]: number | null }[] = result && result.data ? result.data : [];
  const points = fetched
    .map((p) => ({
      ts: p.ts,
      pm2_5: raw ? (p.pm2_5_raw ?? null) : (p.pm2_5 ?? null),
      pm10: raw ? (p.pm10_raw ?? null) : (p.pm10 ?? null),
    }))
    .filter((p) => p.pm2_5 !== null || p.pm10 !== null);
  if (points.length === 0) {
    target.innerHTML = '<div class="panel-card-sub">No history yet.</div>';
    return;
  }
  renderExtendedDotsGrid(points, true, true, target, null);
}

async function renderPanelChart() {
  const zone = panelZone;
  const data = panelData;
  if (!zone || !data) {
    return;
  }
  const request = panelRequest;
  const std = getAQIStandard();
  let labels: string[] = [];
  let values: number[] = [];
  let pills = '';
  let sub = 'µg/m³, hourly';

  if (panelRange === '24h') {
    const history = sortedHistory(data).filter((entry) => historyPm25(entry) !== null);
    labels = history.map((entry) => {
      const d = new Date(entry.ts * 1000);
      return d.getHours() < 10 ? `0${d.getHours()}:00` : `${d.getHours()}:00`;
    });
    values = history.map((entry) => historyPm25(entry) as number);
    pills =
      pillHtml('Last 24 hours', averagePm25(history)) +
      pillHtml('Last 12 hours', averagePm25(history.slice(-12)));
  } else {
    sub = 'µg/m³, daily average';
    const metricName = rawApplies(data) ? 'pm2.5_raw' : 'pm2.5';
    const result = await fetchHistoricalData(zone.id, panelRange, '1d', metricName);
    if (request !== panelRequest) {
      return;
    }
    const key = rawApplies(data) ? 'pm2_5_raw' : 'pm2_5';
    const fetched: { ts: number; [k: string]: number | null }[] = result && result.data ? result.data : [];
    const points = fetched.map((p) => ({ ts: p.ts, pm2_5: p[key] ?? null }));
    const valid = points.filter((p) => p.pm2_5 !== null && p.pm2_5 !== undefined);
    labels = valid.map((p) =>
      new Date(p.ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    );
    values = valid.map((p) => p.pm2_5 as number);
    if (values.length > 0) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const worst = Math.max(...values);
      pills =
        pillHtml(panelRange === '30d' ? '30 day average' : '180 day average', mean) +
        pillHtml('Worst day', worst);
    }
  }

  const canvas = document.getElementById('panel-chart') as HTMLCanvasElement | null;
  const pillsEl = document.getElementById('panel-pills');
  const subEl = document.getElementById('panel-chart-sub');
  if (subEl) {
    subEl.textContent = sub;
  }
  if (pillsEl) {
    pillsEl.innerHTML = pills;
  }
  if (!canvas) {
    return;
  }
  if (panelChart) {
    panelChart.destroy();
    panelChart = null;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const isDark = getCurrentTheme() === 'dark';
  const tickColor = isDark ? '#9aa0aa' : '#64748b';
  const colors = values.map((v) => getAQIColor(pm25ToAqi(v, std), std).hex);
  const config: ChartConfiguration<'bar', number[], string> = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          hoverBackgroundColor: colors.map((c) => hexToRgba(c, 0.8)),
          borderRadius: 3,
          borderSkipped: false,
          categoryPercentage: 0.9,
          barPercentage: 0.9,
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
          displayColors: false,
          callbacks: {
            label: (c) => {
              const value = Number(c.raw) || 0;
              const aqi = pm25ToAqi(value, std);
              return `${value.toFixed(1)} µg/m³  ·  ${getAQICategory(aqi, std)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: tickColor, maxTicksLimit: 6, maxRotation: 0, font: { size: 10 } },
        },
        y: {
          beginAtZero: true,
          position: 'right',
          border: { display: false },
          grid: { color: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)' },
          ticks: { color: tickColor, maxTicksLimit: 5, font: { size: 10 } },
        },
      },
    },
  };
  panelChart = new Chart(ctx, config);
}

function setPanelPinnedState(pinned: boolean) {
  const btn = document.getElementById('panel-pin-btn');
  if (!btn || !panelZone) {
    return;
  }
  btn.classList.toggle('pinned', pinned);
  btn.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${panelZone.name}`);
  const icon = btn.querySelector('.pin-icon');
  if (icon) {
    icon.classList.toggle('pinned', pinned);
  }
}

export function setPanelPinned(pinned: boolean) {
  setPanelPinnedState(pinned);
}

export function openZonePanel(zone: Zone, data: AQIData) {
  const overlay = document.getElementById('map-detail-sheet');
  if (!overlay) {
    return;
  }
  const changed = !panelZone || panelZone.id !== zone.id;
  panelZone = zone;
  panelData = data;
  panelRequest += 1;
  if (changed) {
    panelRange = '24h';
  }
  renderPanel();

  const sheet = overlay.querySelector('.zone-panel') as HTMLElement | null;
  if (sheet && changed) {
    sheet.scrollTop = 0;
  }
  overlay.classList.remove('closing');
  overlay.classList.remove('hidden');
  window.dispatchEvent(new CustomEvent('zonepanel', { detail: { zoneId: zone.id } }));
}

export function refreshZonePanel() {
  if (panelZone && panelData) {
    renderPanel();
  }
}

export function closeZonePanel(announce: boolean = true) {
  const overlay = document.getElementById('map-detail-sheet');
  if (!overlay || overlay.classList.contains('hidden') || overlay.classList.contains('closing')) {
    return;
  }
  overlay.classList.add('closing');
  panelZone = null;
  panelData = null;
  panelRequest += 1;
  const sheet = overlay.querySelector('.zone-panel');
  let done = false;
  const finish = () => {
    if (done) {
      return;
    }
    done = true;
    if (!overlay.classList.contains('closing')) {
      return;
    }
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
    if (panelChart) {
      panelChart.destroy();
      panelChart = null;
    }
  };
  sheet?.addEventListener('animationend', finish, { once: true });
  window.setTimeout(finish, 600);
  if (announce) {
    window.dispatchEvent(new CustomEvent('zonepanel', { detail: { zoneId: null } }));
  }
}

function setPanelRange(range: PanelRange) {
  panelRange = range;
  document.querySelectorAll('.panel-range .btn-outlined').forEach((btn) => {
    btn.classList.toggle('active', btn.textContent?.trim() === range);
  });
  renderPanelChart();
}

async function sharePanelZone() {
  if (!panelZone) {
    return;
  }
  const url = `https://breatheoss.app/zone/${encodeURIComponent(panelZone.id)}`;
  const title = `${panelZone.name} air quality | Breathe`;
  const nav = navigator as Navigator & { share?: (data: { title: string; url: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title, url });
      return;
    } catch (e) {
      return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showSnackbar('Link copied');
  } catch (e) {
    showSnackbar(url);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && panelZone) {
    closeZonePanel();
  }
});

(window as any).closeMapDetailSheet = () => closeZonePanel();
(window as any).setPanelRange = setPanelRange;
(window as any).sharePanelZone = sharePanelZone;
(window as any).openFullDetails = () => {
  if (!panelZone) {
    return;
  }
  const id = panelZone.id;
  closeZonePanel(false);
  (window as any).openDetails(id);
};
