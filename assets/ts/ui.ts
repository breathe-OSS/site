import { getAQIColor, getCurrentTheme } from './utils.js';
import { Zone, AQIData, AQIHistory, Pollutants } from './types.js';
import type { Chart as ChartJS, ChartConfiguration } from 'chart.js';

declare const Chart: typeof ChartJS;
type LineChart = InstanceType<typeof Chart<'line', number[], string>>;

// Chart is loaded via CDN, so we type the global constructor for TS.
let detailChart: LineChart | null = null;

// Pin icon SVGs
const PINNED_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Z"/></svg>';
const UNPINNED_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Zm126 0Z"/></svg>';

function getPinIcon(isPinned: boolean): string {
  return isPinned ? PINNED_ICON : UNPINNED_ICON;
}

function getTrendHTML(currentAqi: number, currentTs: number, history: AQIHistory[]): string {
  if (!history || history.length === 0) return '';
  const oneHourAgo = currentTs - 3600;
  const validHistory = history.filter(h => Math.abs(h.ts - oneHourAgo) < 1800);
  if (validHistory.length === 0) return '';
  validHistory.sort((a, b) => Math.abs(a.ts - oneHourAgo) - Math.abs(b.ts - oneHourAgo));
  const pastEntry = validHistory[0];
  const diff = currentAqi - pastEntry.aqi;
  if (diff === 0) return '<span class="trend-neutral">-- (1h)</span>';
  const isRising = diff > 0;
  const sign = isRising ? '+' : '';
  const arrow = isRising ? '▲' : '▼';
  const colorClass = isRising ? 'trend-up' : 'trend-down';
  return `<span class="${colorClass}">${arrow} ${sign}${diff} (1h)</span>`;
}

// main dashboard
export function renderDashboardCard(zone: Zone, data: AQIData, onClick: () => void): HTMLElement {
  const colorClass = getAQIColor(data.aqi).bg;
  const card = document.createElement('div');
  card.className = 'dashboard-card';
  card.onclick = onClick;
  card.innerHTML = `
        <div>
            <h3 style="margin:0; font-size:18px;">${zone.name}</h3>
            <p style="margin:4px 0 0 0; color:var(--on-surface-variant); font-size:12px;">
                ${data.main_pollutant.toUpperCase()}
            </p>
        </div>
        <div class="aqi-badge-small ${colorClass}">
            ${data.aqi}
        </div>
    `;
  return card;
}

export function renderSkeletonCard(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'dashboard-card skeleton-card';
  card.innerHTML = `
        <div style="flex: 1;">
            <div class="skeleton-line" style="width: 60%; height: 18px; margin-bottom: 8px;"></div>
            <div class="skeleton-line" style="width: 40%; height: 12px;"></div>
        </div>
        <div class="skeleton-badge"></div>
    `;
  return card;
}

// explore
export function renderExploreItem(
  zone: Zone,
  isPinned: boolean,
  onPinClick: () => void
): HTMLElement {
  const div = document.createElement('div');
  div.className = 'explore-card';
  div.innerHTML = `
        <div>
            <div style="font-weight:500; font-size:16px; margin-bottom:4px;">${zone.name}</div>
            <div style="font-size:12px; color:var(--on-surface-variant);">${
              zone.provider || 'openmeteo'
            }</div>
        </div>
        <button class="pin-btn ${isPinned ? 'pinned' : ''}">
            ${getPinIcon(isPinned)}
        </button>
    `;
  const btn = div.querySelector('.pin-btn') as HTMLButtonElement;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onPinClick();
    btn.classList.toggle('pinned');
    const newIsPinned = btn.classList.contains('pinned');
    btn.innerHTML = getPinIcon(newIsPinned);
  });
  return div;
}

// details
export function updateDetailView(zone: Zone, data: AQIData) {
  const titleHeader = document.getElementById('detail-title-header');
  if (titleHeader) titleHeader.innerText = zone.name;

  const colors = getAQIColor(data.aqi);
  const aqiEl = document.getElementById('detail-aqi');
  const chipEl = document.querySelector('.naqi-chip') as HTMLElement;
  const primaryEl = document.getElementById('detail-primary');
  const updatedEl = document.getElementById('detail-updated');
  const trendEl = document.getElementById('detail-trend');
  const providerContainer = document.getElementById('detail-provider');

  if (aqiEl) {
    aqiEl.innerText = data.aqi.toString();
    aqiEl.style.color = colors.hex;
  }
  if (chipEl) chipEl.style.backgroundColor = colors.hex;
  if (primaryEl) primaryEl.innerText = `Primary: ${data.main_pollutant.toUpperCase()}`;

  if (trendEl) {
    trendEl.innerHTML = getTrendHTML(data.aqi, data.timestamp_unix, data.history);
  }

  if (updatedEl) {
    const now = Date.now() / 1000;
    const diff = Math.floor((now - data.timestamp_unix) / 60);
    updatedEl.innerText = `Updated ${diff} min ago`;
  }

  // Provider Logo
  if (providerContainer) {
    const provider = zone.provider || 'openmeteo';
    if (provider === 'openaq') {
      providerContainer.innerHTML = `<a href="https://openaq.org" target="_blank" class="provider-link"><div class="openaq-bg"><img src="assets/images/open_aq_logo.png" alt="OpenAQ" style="height:20px; display:block;"></div></a>`;
    } else {
      providerContainer.innerHTML = `
                <a href="https://open-meteo.com" target="_blank" class="provider-link">
                    <img src="assets/images/open_meteo_logo.png" class="dark-only" alt="OpenMeteo" style="height:24px;">
                    <img src="assets/images/open_meteo_logo_light.png" class="light-only" alt="OpenMeteo" style="height:24px;">
                </a>
            `;
    }
  }

  renderPollutantGrid(data.concentrations_us_units || {});
  renderChart(data.history);
}

function renderPollutantGrid(comps: Pollutants) {
  const container = document.getElementById('pollutant-grid');
  if (!container) return;
  container.innerHTML = '';

  const defs = [
    { key: 'pm2_5', label: 'PM2.5', unit: 'µg/m³' },
    { key: 'co', label: 'CO', unit: 'mg/m³' },
    { key: 'pm10', label: 'PM10', unit: 'µg/m³' },
    { key: 'so2', label: 'SO₂', unit: 'µg/m³' },
    { key: 'no2', label: 'NO₂', unit: 'µg/m³' },
    { key: 'o3', label: 'O₃', unit: 'µg/m³' },
  ];

  defs.forEach((def) => {
    if (comps[def.key] !== undefined) {
      const div = document.createElement('div');
      div.className = 'pollutant-card';
      div.innerHTML = `
                <span class="p-name">${def.label}</span>
                <span class="p-value">
                    ${comps[def.key]}<span class="p-unit">${def.unit}</span>
                </span>
            `;
      container.appendChild(div);
    }
  });
}

export function updateChartTheme() {
  if (detailChart) detailChart.update();
}

function renderChart(history: AQIHistory[]) {
  const canvas = document.getElementById('detailChart') as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (detailChart) detailChart.destroy();

  const sorted = history.sort((a, b) => a.ts - b.ts);
  const labels = sorted.map((h) => {
    const d = new Date(h.ts * 1000);
    return `${d.getHours()}:00`;
  });
  const values = sorted.map((h) => h.aqi);

  const isDark = getCurrentTheme() === 'dark';
  const lineColor = '#a8c7fa';

  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, isDark ? 'rgba(168, 199, 250, 0.4)' : 'rgba(65, 105, 225, 0.4)');
  gradient.addColorStop(1, isDark ? 'rgba(168, 199, 250, 0.0)' : 'rgba(65, 105, 225, 0.0)');

  const config: ChartConfiguration<'line', number[], string> = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          data: values,
          borderColor: lineColor,
          backgroundColor: gradient,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 6,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: { x: { display: false }, y: { display: false, min: 0 } },
      layout: { padding: 0 },
    },
  };

  detailChart = new Chart(ctx, config);
}