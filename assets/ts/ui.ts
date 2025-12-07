import { getAQIColor, getCurrentTheme } from './utils.js';
import { Zone, AQIData, AQIHistory, Pollutants } from './types.js';

declare const Chart: any;
let detailChart: any = null;

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
            <div style="font-size:12px; color:var(--on-surface-variant);">${zone.provider || 'openmeteo'}</div>
        </div>
        <button class="pin-btn ${isPinned ? 'pinned' : ''}">
            <svg viewBox="0 0 24 24"><path d="M16 9V4l1 1c.55.55 1.45.55 2 0s.55-1.45 0-2l-7-7-7 7c-.55.55-.55 1.45 0 2s1.45.55 2 0l1-1v5c0 1.66-1.34 3-3 3h-1v2h12v-2h-1c-1.66 0-3-1.34-3-3zM12 2C13 2 14 3 14 4V9H10V4C10 3 11 2 12 2M12 14C13.5 14 15 13 15 11.5V10H9V11.5C9 13 10.5 14 12 14Z" transform="rotate(45 12 12)"/></svg>
        </button>
    `;
  const btn = div.querySelector('.pin-btn') as HTMLButtonElement;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onPinClick();
    btn.classList.toggle('pinned');
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
  const providerContainer = document.getElementById('detail-provider');

  if (aqiEl) {
    aqiEl.innerText = data.aqi.toString();
    aqiEl.style.color = colors.hex;
  }
  if (chipEl) chipEl.style.backgroundColor = colors.hex;
  if (primaryEl) primaryEl.innerText = `Primary: ${data.main_pollutant.toUpperCase()}`;

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

  detailChart = new Chart(ctx, {
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
  });
}
