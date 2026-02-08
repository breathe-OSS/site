import { getAQIColor, getCurrentTheme, calculateCigarettes, getAQIStandard, getAQICategory, getAQIBarPosition } from './utils.js';
import { Zone, AQIData, AQIHistory, Pollutants } from './types.js';
import type { Chart as ChartJS, ChartConfiguration } from 'chart.js';

declare const Chart: typeof ChartJS;
type LineChart = InstanceType<typeof Chart<'line', number[], string>>;

let detailChart: LineChart | null = null;

// Pin icon SVGs
const PINNED_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Z"/></svg>';
const UNPINNED_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Zm126 0Z"/></svg>';

// Checkmark icon for selected chips
const CHECKMARK_ICON = '<svg class="checkmark" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

function getPinIcon(isPinned: boolean): string {
  return isPinned ? PINNED_ICON : UNPINNED_ICON;
}

function getTrendHTML(currentAqi: number, currentTs: number, history: AQIHistory[]): string {
  if (!history || history.length === 0) return '';
  const oneHourAgo = currentTs - 3600;
  const std = getAQIStandard();
  
  const validHistory = history.filter(h => Math.abs(h.ts - oneHourAgo) < 1800);
  if (validHistory.length === 0) return '';
  
  validHistory.sort((a, b) => Math.abs(a.ts - oneHourAgo) - Math.abs(b.ts - oneHourAgo));
  const pastEntry = validHistory[0];
  
  const pastVal = std === 'us' ? (pastEntry.us_aqi || 0) : pastEntry.aqi;
  const diff = currentAqi - pastVal;
  
  if (diff === 0) return '<span class="trend-badge">-- /hr</span>';
  const isRising = diff > 0;
  const sign = isRising ? '+' : '';
  const arrow = isRising ? '↑' : '↓';
  const colorClass = isRising ? 'worsening' : 'improving';
  return `<span class="trend-badge ${colorClass}">${arrow} ${sign}${diff} /hr</span>`;
}

// Render pinned location chips
export function renderPinnedChips(
  zones: { zone: Zone; data: AQIData }[],
  selectedId: string | null,
  onSelect: (id: string) => void
): void {
  const container = document.getElementById('pinned-chips');
  if (!container) return;
  container.innerHTML = '';

  zones.forEach(({ zone, data }) => {
    const std = getAQIStandard();
    const displayAqi = std === 'us' ? (data.us_aqi || 0) : data.aqi;
    const colors = getAQIColor(displayAqi, std);
    const isSelected = zone.id === selectedId;
    
    const chip = document.createElement('button');
    chip.className = `pinned-chip${isSelected ? ' selected' : ''}`;
    chip.onclick = () => onSelect(zone.id);
    
    chip.innerHTML = `
      ${isSelected ? CHECKMARK_ICON : ''}
      <span class="status-dot" style="background: ${colors.hex};"></span>
      ${zone.name}
    `;
    
    container.appendChild(chip);
  });
}

// Render now viewing section in dashboard
export function renderNowViewing(zone: Zone, data: AQIData): void {
  const container = document.getElementById('now-viewing-container');
  if (!container) return;

  const std = getAQIStandard();
  const displayAqi = std === 'us' ? (data.us_aqi || 0) : data.aqi;
  const colors = getAQIColor(displayAqi, std);
  const category = getAQICategory(displayAqi, std);
  const barPosition = getAQIBarPosition(displayAqi, std);
  const provider = zone.provider || 'openmeteo';
  const isLive = provider === 'airgradient';

  const now = Date.now() / 1000;
  const diff = Math.floor((now - data.timestamp_unix) / 60);
  const trendHtml = getTrendHTML(displayAqi, data.timestamp_unix, data.history);

  container.innerHTML = `
    <div class="now-viewing">
      <div class="now-viewing-left">
        <div class="now-viewing-badge">
          <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
          Now Viewing
        </div>
        <div class="now-viewing-name">${zone.name}</div>
        ${isLive ? `
          <div class="now-viewing-source">
            <span class="live-dot"></span>
            Live Ground Sensors
          </div>
        ` : `
          <div class="now-viewing-source" style="color: var(--on-surface-variant);">
            Satellite and Model data
          </div>
        `}
      </div>
      ${isLive ? `
        <a href="https://airgradient.com" target="_blank" class="provider-link">
          <img src="assets/images/air_gradient_logo.png" alt="AirGradient" style="height: 24px;">
        </a>
      ` : ''}
    </div>

    <div class="card main-aqi-card" style="--aqi-color: ${colors.hex};">
      <div class="aqi-header" style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
        <div style="text-align: left;">
          <div class="aqi-display-large" style="color: ${colors.hex};">${displayAqi}</div>
          <div class="naqi-chip" style="background: ${colors.hex};">${std === 'us' ? 'US AQI' : 'NAQI'}</div>
        </div>
        <div style="text-align: right;">
          <div class="primary-pollutant-label">Primary</div>
          <div class="primary-pollutant-value">${data.main_pollutant.toUpperCase()}</div>
          ${trendHtml}
          <div class="update-time">${diff}m ago</div>
        </div>
      </div>
    </div>

    <div class="aqi-bar-container">
      <div class="aqi-bar-label" style="color: ${colors.hex};">${category}</div>
      <div class="aqi-bar${std === 'us' ? ' aqi-bar-us' : ''}">
        <div class="aqi-bar-gradient"></div>
        <div class="aqi-bar-indicator" style="left: ${barPosition}%;"></div>
      </div>
    </div>

    ${renderCigaretteCard(data.concentrations_us_units['pm2_5'] || 0)}
    ${renderConcentrationsPreview(data.concentrations_us_units)}
  `;
}

function renderCigaretteCard(pm25: number): string {
  const cigs = calculateCigarettes(pm25);
  if (cigs <= 0.1) return '';
  
  return `
    <div class="cigarette-card">
      <div class="cigarette-icon">
        <svg viewBox="0 0 24 24"><path d="M2 16h15v3H2zm18.5 0H22v3h-1.5zM18 16h1.5v3H18zm.85-8.27c.62-.61 1-1.45 1-2.38C19.85 3.5 18.35 2 16.5 2v1.5c1.02 0 1.85.83 1.85 1.85S17.52 7.2 16.5 7.2v1.5c2.24 0 4 1.83 4 4.07V15H22v-2.24c0-2.22-1.28-4.14-3.15-5.03zm-2.82 2.47H14.5c-1.02 0-1.85-.98-1.85-2s.83-1.75 1.85-1.75v-1.5c-1.85 0-3.35 1.5-3.35 3.35s1.5 3.35 3.35 3.35h1.53c1.05 0 1.97.74 1.97 2.05V15h1.5v-1.64c0-1.81-1.6-3.16-3.47-3.16z"/></svg>
      </div>
      <div class="cigarette-content">
        <div class="cigarette-value">≈ ${cigs} cigarettes</div>
        <div class="cigarette-label">Equivalent PM2.5 inhalation today</div>
      </div>
    </div>
  `;
}

function renderConcentrationsPreview(comps: Pollutants): string {
  const defs = [
    { key: 'pm2_5', label: 'PM2.5', unit: 'µg/m³' },
    { key: 'pm10', label: 'PM10', unit: 'µg/m³' },
  ];

  const available = defs.filter(d => comps[d.key] !== undefined);
  if (available.length === 0) return '';
  
  return `
    <div class="concentrations-section">
      <div class="concentrations-title">Concentrations</div>
      <div class="concentrations-grid">
        ${available.map(def => `
          <div class="concentration-card">
            <span class="concentration-label">${def.label}</span>
            <div class="concentration-value">
              <span class="value">${comps[def.key]}</span>
              <span class="unit">${def.unit}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// main dashboard
export function renderDashboardCard(zone: Zone, data: AQIData, onClick: () => void, index: number = 0): HTMLElement {
  const std = getAQIStandard();
  // Fallback to NAQI if us_aqi is missing (0)
  const displayAqi = std === 'us' ? (data.us_aqi || 0) : data.aqi;
  const colorClass = getAQIColor(displayAqi, std).bg;
  
  const card = document.createElement('div');
  card.className = 'dashboard-card';
  card.style.animationDelay = `${index * 50}ms`;
  card.onclick = onClick;
  card.innerHTML = `
        <div>
            <h3 style="margin:0; font-size:18px; font-weight: 600;">${zone.name}</h3>
            <p style="margin:4px 0 0 0; color:var(--on-surface-variant); font-size:12px;">
                ${data.main_pollutant.toUpperCase()}
            </p>
        </div>
        <div class="aqi-badge-small ${colorClass}">
            ${displayAqi}
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
        <div class="explore-card-inner">
            <div>
                <div style="font-weight:500; font-size:16px; margin-bottom:4px;">${zone.name}</div>
                <div style="font-size:12px; color:var(--on-surface-variant);">${
                  zone.provider || 'openmeteo'
                }</div>
            </div>
            <button class="pin-btn ${isPinned ? 'pinned' : ''}">
                ${getPinIcon(isPinned)}
            </button>
        </div>
    `;
  const btn = div.querySelector('.pin-btn') as HTMLButtonElement;
  const handlePin = () => {
    onPinClick();
    btn.classList.toggle('pinned');
    const newIsPinned = btn.classList.contains('pinned');
    btn.innerHTML = getPinIcon(newIsPinned);
    div.classList.remove('pin-flash');
    void div.offsetWidth;
    div.classList.add('pin-flash');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlePin();
  });
  div.addEventListener('click', handlePin);
  div.addEventListener('animationend', () => div.classList.remove('pin-flash'));
  div.style.cursor = 'pointer';
  return div;
}

// details
export function updateDetailView(zone: Zone, data: AQIData) {
  const titleHeader = document.getElementById('detail-title-header');
  if (titleHeader) titleHeader.innerText = zone.name;

  const std = getAQIStandard();
  const displayAqi = std === 'us' ? (data.us_aqi || 0) : data.aqi;
  const colors = getAQIColor(displayAqi, std);
  const category = getAQICategory(displayAqi, std);
  const barPosition = getAQIBarPosition(displayAqi, std);
  
  // Now viewing section elements
  const zoneNameEl = document.getElementById('detail-zone-name');
  const sourceIndicatorEl = document.getElementById('detail-source-indicator');
  
  // Main card elements
  const aqiEl = document.getElementById('detail-aqi');
  const chipEl = document.getElementById('detail-standard-chip') as HTMLElement;
  const primaryEl = document.getElementById('detail-primary');
  const updatedEl = document.getElementById('detail-updated');
  const trendEl = document.getElementById('detail-trend');
  const providerContainer = document.getElementById('detail-provider');
  const cigaretteContainer = document.getElementById('cigarette-card-container');
  const mainCard = document.getElementById('detail-main-card');
  
  // AQI Bar elements
  const aqiBarContainer = document.getElementById('aqi-bar-container');
  const aqiBarLabel = document.getElementById('aqi-bar-label');
  const aqiBar = document.getElementById('aqi-bar');
  const aqiBarIndicator = document.getElementById('aqi-bar-indicator');

  // Update now viewing section
  if (zoneNameEl) zoneNameEl.innerText = zone.name;
  
  const provider = zone.provider || 'openmeteo';
  if (sourceIndicatorEl) {
    if (provider === 'airgradient') {
      sourceIndicatorEl.innerHTML = `
        <span class="live-dot"></span>
        Live Ground Sensors
      `;
      sourceIndicatorEl.style.color = '';
      sourceIndicatorEl.style.display = 'flex';
    } else {
      sourceIndicatorEl.innerHTML = `Satellite and Model data`;
      sourceIndicatorEl.style.color = 'var(--on-surface-variant)';
      sourceIndicatorEl.style.display = 'flex';
    }
  }

  // Update main card with gradient background
  if (mainCard) {
    mainCard.style.setProperty('--aqi-color', colors.hex);
  }

  let warningEl = document.getElementById('detail-warning');
  if (data.warning && warningEl) {
    warningEl.innerHTML = `
      <div style="background: rgba(255, 82, 82, 0.1); border: 1px solid var(--aqi-very-poor); border-radius: 16px; padding: 16px; display: flex; align-items: start; gap: 12px; margin-bottom: 16px;">
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="var(--aqi-very-poor)"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
          <div style="font-size: 13px; color: var(--on-surface); line-height: 1.5;">${data.warning}</div>
      </div>
    `;
  } else if (warningEl) {
    warningEl.innerHTML = '';
  }

  if (aqiEl) {
    aqiEl.innerText = displayAqi.toString();
    aqiEl.style.color = colors.hex;
  }
  
  if (chipEl) {
    chipEl.style.backgroundColor = colors.hex;
    chipEl.innerText = std === 'us' ? 'US AQI' : 'NAQI';
  }
  
  if (primaryEl) primaryEl.innerText = data.main_pollutant.toUpperCase();

  if (trendEl) {
    trendEl.innerHTML = getTrendHTML(displayAqi, data.timestamp_unix, data.history);
  }

  if (updatedEl) {
    const now = Date.now() / 1000;
    const diff = Math.floor((now - data.timestamp_unix) / 60);
    updatedEl.innerText = `${diff}m ago`;
  }

  // Update AQI Bar
  if (aqiBarLabel) {
    aqiBarLabel.innerText = category;
    aqiBarLabel.style.color = colors.hex;
  }
  
  if (aqiBar) {
    if (std === 'us') {
      aqiBar.classList.add('aqi-bar-us');
    } else {
      aqiBar.classList.remove('aqi-bar-us');
    }
  }
  
  if (aqiBarIndicator) {
    aqiBarIndicator.style.left = `${barPosition}%`;
  }

  // Cigarettes Card
  if (cigaretteContainer) {
    const pm25 = data.concentrations_us_units['pm2_5'] || 0;
    const cigs = calculateCigarettes(pm25);
    
    if (cigs > 0.1) {
      cigaretteContainer.innerHTML = `
        <div class="cigarette-card">
          <div class="cigarette-icon">
            <svg viewBox="0 0 24 24"><path d="M2 16h15v3H2zm18.5 0H22v3h-1.5zM18 16h1.5v3H18zm.85-8.27c.62-.61 1-1.45 1-2.38C19.85 3.5 18.35 2 16.5 2v1.5c1.02 0 1.85.83 1.85 1.85S17.52 7.2 16.5 7.2v1.5c2.24 0 4 1.83 4 4.07V15H22v-2.24c0-2.22-1.28-4.14-3.15-5.03zm-2.82 2.47H14.5c-1.02 0-1.85-.98-1.85-2s.83-1.75 1.85-1.75v-1.5c-1.85 0-3.35 1.5-3.35 3.35s1.5 3.35 3.35 3.35h1.53c1.05 0 1.97.74 1.97 2.05V15h1.5v-1.64c0-1.81-1.6-3.16-3.47-3.16z"/></svg>
          </div>
          <div class="cigarette-content">
            <div class="cigarette-value">≈ ${cigs} cigarettes</div>
            <div class="cigarette-label">Equivalent PM2.5 inhalation today</div>
          </div>
        </div>
      `;
    } else {
      cigaretteContainer.innerHTML = '';
    }
  }

  // Provider Logo
  if (providerContainer) {
    if (provider === 'airgradient') {
      providerContainer.innerHTML = `
        <a href="https://airgradient.com" target="_blank" class="provider-link">
          <img src="assets/images/air_gradient_logo.png" alt="AirGradient" style="height: 24px; display: block;">
        </a>`;
    } else {
      providerContainer.innerHTML = `
        <a href="https://open-meteo.com" target="_blank" class="provider-link">
          <img src="assets/images/open_meteo_logo.png" class="dark-only" alt="OpenMeteo" style="height: 24px;">
          <img src="assets/images/open_meteo_logo_light.png" class="light-only" alt="OpenMeteo" style="height: 24px;">
        </a>`;
    }
  }

  renderPollutantGrid(data.concentrations_us_units || {});
  renderChart(data.history);
}

function renderConcentrationsDisplay(comps: Pollutants) {
  const container = document.getElementById('concentrations-display');
  if (!container) return;
  container.innerHTML = '';

  const mainPollutants = [
    { key: 'pm2_5', label: 'PM2.5', unit: 'µg/m³' },
    { key: 'pm10', label: 'PM10', unit: 'µg/m³' },
  ];

  mainPollutants.forEach((def) => {
    if (comps[def.key] !== undefined) {
      const div = document.createElement('div');
      div.className = 'concentration-card';
      div.innerHTML = `
        <span class="concentration-label">${def.label}</span>
        <div class="concentration-value">
          <span class="value">${comps[def.key]}</span>
          <span class="unit">${def.unit}</span>
        </div>
      `;
      container.appendChild(div);
    }
  });
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

  const std = getAQIStandard();
  const sorted = history.sort((a, b) => a.ts - b.ts);
  const labels = sorted.map((h) => {
    const d = new Date(h.ts * 1000);
    return `${d.getHours()}:00`;
  });
  
  // Choose correct dataset based on standard
  const values = sorted.map((h) => std === 'us' ? (h.us_aqi || 0) : h.aqi);

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