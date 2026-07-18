import {
  getAQIColor,
  getCurrentTheme,
  calculateCigarettes,
  getAQIStandard,
  getAQICategory,
  getAQIBarPosition,
  formatPollutantName,
  calculateUsAqi,
  calculateUsAqiPm10,
} from './utils.js';
import { Zone, AQIData, AQIHistory, Pollutants, NodeData } from './types.js';
import type { Chart as ChartJS, ChartConfiguration } from 'chart.js';

declare const Chart: typeof ChartJS;
type LineChart = InstanceType<typeof Chart<'line', number[], string>>;

let detailChart: LineChart | null = null;

// Pin icon SVGs
const PINNED_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Z"/></svg>';
const UNPINNED_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Zm126 0Z"/></svg>';

// Checkmark icon for selected chips
const CHECKMARK_ICON =
  '<svg class="checkmark" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

export function getPinIcon(isPinned: boolean): string {
  return isPinned ? PINNED_ICON : UNPINNED_ICON;
}

function getTrendHTML(currentAqi: number, currentTs: number, history: AQIHistory[]): string {
  if (!history || history.length === 0) return '';
  const oneHourAgo = currentTs - 3600;
  const std = getAQIStandard();

  const validHistory = history.filter((h) => Math.abs(h.ts - oneHourAgo) < 1800);
  if (validHistory.length === 0) return '';

  validHistory.sort((a, b) => Math.abs(a.ts - oneHourAgo) - Math.abs(b.ts - oneHourAgo));
  const pastEntry = validHistory[0];

  const pastVal = std === 'us' ? pastEntry.us_aqi || 0 : pastEntry.aqi;
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
    const displayAqi = std === 'us' ? data.us_aqi || 0 : data.aqi;
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
  const displayAqi = std === 'us' ? data.us_aqi || 0 : data.aqi;
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
        ${
          isLive
            ? `
          <div class="now-viewing-source">
            <span class="live-dot"></span>
            Live Ground Sensors
          </div>
        `
            : `
          <div class="now-viewing-source" style="color: var(--on-surface-variant);">
            Satellite and Model data
          </div>
        `
        }
      </div>
      ${
        isLive
          ? `
        <a href="https://airgradient.com" target="_blank" class="provider-link">
          <img src="assets/images/air_gradient_logo.png" alt="AirGradient" style="height: 24px;">
        </a>
      `
          : ''
      }
    </div>

    <div class="card main-aqi-card" style="--aqi-color: ${colors.hex};">
      <div class="aqi-header" style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
        <div style="text-align: left;">
          <div class="aqi-display-large" style="color: ${colors.hex};">${displayAqi}</div>
          <div class="naqi-chip" style="background: ${colors.hex};">${std === 'us' ? 'US AQI' : 'NAQI'}</div>
          ${trendHtml}
        </div>
        <div style="text-align: right;">
          <div class="primary-pollutant-label">Primary</div>
          <div class="primary-pollutant-value">${formatPollutantName(data.main_pollutant)}</div>
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

    ${renderCigaretteCard(data.averages_24h?.['pm2_5'] || data.concentrations_us_units['pm2_5'] || 0)}
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
        <div class="cigarette-label">Equivalent PM<sub>2.5</sub> inhalation today</div>
      </div>
    </div>
  `;
}

function renderConcentrationsPreview(comps: Pollutants): string {
  const defs = [
    { key: 'pm2_5', label: 'PM<sub>2.5</sub>', unit: 'µg/m³' },
    { key: 'pm10', label: 'PM<sub>10</sub>', unit: 'µg/m³' },
  ];

  const available = defs.filter((d) => comps[d.key] !== undefined);
  if (available.length === 0) return '';

  return `
    <div class="concentrations-section">
      <div class="concentrations-title">Concentrations</div>
      <div class="concentrations-grid">
        ${available
          .map(
            (def) => `
          <div class="concentration-card">
            <span class="concentration-label">${def.label}</span>
            <div class="concentration-value">
              <span class="value">${comps[def.key]}</span>
              <span class="unit">${def.unit}</span>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;
}

// main dashboard
export function renderDashboardCard(
  zone: Zone,
  data: AQIData,
  onClick: () => void,
  index: number = 0
): HTMLElement {
  const std = getAQIStandard();
  // Fallback to NAQI if us_aqi is missing (0)
  const displayAqi = std === 'us' ? data.us_aqi || 0 : data.aqi;
  const colors = getAQIColor(displayAqi, std);

  const card = document.createElement('div');
  card.className = 'dashboard-card';
  card.style.animationDelay = `${index * 50}ms`;
  card.onclick = onClick;
  card.innerHTML = `
        <div>
            <h3 style="margin:0; font-size:18px; font-weight: 600;">${zone.name}</h3>
            <p style="margin:4px 0 0 0; color:var(--on-surface-variant); font-size:12px;">
                ${formatPollutantName(data.main_pollutant)}
            </p>
        </div>
        <div class="aqi-badge-small" style="background-color: ${colors.hex};">
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
 const providerText = provider === 'airgradient' 
    ? '<span class="status-indicator"></span> Live Ground Sensors' 
    : 'Satellite & Model Data';

  div.innerHTML = `
        <div class="explore-card-inner">
            <div>
                <div style="font-weight:500; font-size:16px; margin-bottom:4px;">${zone.name}</div>
                <div style="font-size:12px; color:var(--on-surface-variant);">${providerText}</div>
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
  const displayAqi = std === 'us' ? data.us_aqi || 0 : data.aqi;
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

  const btnHistory = document.getElementById('btn-extended-history');
  if (btnHistory) {
      if (provider === 'airgradient') {
          btnHistory.style.display = 'block';
      } else {
          btnHistory.style.display = 'none';
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

  if (primaryEl) primaryEl.innerHTML = formatPollutantName(data.main_pollutant);

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
    const pm25 = data.averages_24h?.['pm2_5'] || data.concentrations_us_units['pm2_5'] || 0;
    const cigs = calculateCigarettes(pm25);

    if (cigs > 0.1) {
      cigaretteContainer.innerHTML = `
        <div class="cigarette-card">
          <div class="cigarette-icon">
            <svg viewBox="0 0 24 24"><path d="M2 16h15v3H2zm18.5 0H22v3h-1.5zM18 16h1.5v3H18zm.85-8.27c.62-.61 1-1.45 1-2.38C19.85 3.5 18.35 2 16.5 2v1.5c1.02 0 1.85.83 1.85 1.85S17.52 7.2 16.5 7.2v1.5c2.24 0 4 1.83 4 4.07V15H22v-2.24c0-2.22-1.28-4.14-3.15-5.03zm-2.82 2.47H14.5c-1.02 0-1.85-.98-1.85-2s.83-1.75 1.85-1.75v-1.5c-1.85 0-3.35 1.5-3.35 3.35s1.5 3.35 3.35 3.35h1.53c1.05 0 1.97.74 1.97 2.05V15h1.5v-1.64c0-1.81-1.6-3.16-3.47-3.16z"/></svg>
          </div>
          <div class="cigarette-content">
            <div class="cigarette-value">≈ ${cigs} cigarettes</div>
            <div class="cigarette-label">Equivalent PM<sub>2.5</sub> inhalation today</div>
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
  renderNodeReadings(data.nodes || {});

  const chartSelect = document.getElementById('chart-node-select') as HTMLSelectElement;
  const chartLocationName = document.getElementById('chart-location-name');
  if (chartSelect) {
    const nodeNames = data.nodes ? Object.keys(data.nodes) : [];
    const nodesWithHistory = nodeNames.filter(name => data.nodes![name].history && data.nodes![name].history!.length > 0);
    
    if (nodesWithHistory.length > 0) {
      chartSelect.classList.remove('hidden');
      if (chartLocationName) {
        chartLocationName.style.display = 'inline';
        chartLocationName.innerText = 'Zone Average';
      }
      chartSelect.innerHTML = `<option value="zone">Zone Average</option>`;
      nodesWithHistory.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.innerText = name;
        chartSelect.appendChild(option);
      });

      chartSelect.onchange = () => {
        const val = chartSelect.value;
        if (chartLocationName) {
           chartLocationName.innerText = val === 'zone' ? 'Zone Average' : val;
        }
        if (val === 'zone') {
          renderChart(data.history);
          renderDotsHistory(data.history);
        } else {
          const history = data.nodes?.[val]?.history;
          if (history) {
            renderChart(history);
            renderDotsHistory(history);
          }
        }
      };
      
      chartSelect.addEventListener('click', (e) => e.stopPropagation());
      chartSelect.addEventListener('mousedown', (e) => e.stopPropagation());
      chartSelect.addEventListener('touchstart', (e) => e.stopPropagation());
      
      chartSelect.value = 'zone';
    } else {
      chartSelect.classList.add('hidden');
      if (chartLocationName) chartLocationName.style.display = 'none';
    }
  }

  renderChart(data.history);
  renderDotsHistory(data.history);
  setupChartPager();
}

function renderNodeReadings(nodes: { [name: string]: NodeData }) {
  const container = document.getElementById('node-readings-container');
  if (!container) return;

  const nodeNames = Object.keys(nodes);
  if (nodeNames.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  const std = getAQIStandard();

  container.innerHTML = `
    <h3 class="section-title">Individual Node Readings</h3>
    <div class="node-grid">
      ${nodeNames
        .map((name) => {
          const node = nodes[name];
          const displayAqi = std === 'us' ? node.us_aqi || 0 : node.aqi;
          const colors = getAQIColor(displayAqi, std);

          return `
          <div class="node-card">
            <div class="node-header">
              <span class="node-name">${name}</span>
              <button class="icon-btn-compact" onclick="openNodeDetails('${name}', '${getAQIStandard()}', ${displayAqi}, ${node.temp}, ${node.humidity}, ${node.pm2_5}, ${node.pm10})" style="color: var(--on-surface-variant); position: absolute; right: -8px; top: -8px;">
                <svg viewBox="0 0 24 24" width="20" height="20"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" fill="currentColor"/></svg>
              </button>
            </div>
            <div class="node-aqi-section">
              <div class="node-aqi-value" style="color: ${colors.hex}">${displayAqi}</div>
              <div class="node-aqi-label">${std === 'us' ? 'US AQI' : 'NAQI'}</div>
            </div>
            <div class="node-separator"></div>
            <div class="node-pollutants">
              <div class="node-pollutant">
                <span class="node-pollutant-label">PM2.5</span>
                <span class="node-pollutant-value">${node.pm2_5}</span>
              </div>
              <div class="node-pollutant">
                <span class="node-pollutant-label">PM10</span>
                <span class="node-pollutant-value">${node.pm10}</span>
              </div>
            </div>
          </div>
        `;
        })
        .join('')}
    </div>
  `;
}

function renderConcentrationsDisplay(comps: Pollutants) {
  const container = document.getElementById('concentrations-display');
  if (!container) return;
  container.innerHTML = '';

  const mainPollutants = [
    { key: 'pm2_5', label: 'PM<sub>2.5</sub>', unit: 'µg/m³' },
    { key: 'pm10', label: 'PM<sub>10</sub>', unit: 'µg/m³' },
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
    { key: 'pm2_5', label: 'PM<sub>2.5</sub>', unit: 'µg/m³' },
    { key: 'co', label: 'CO', unit: 'mg/m³' },
    { key: 'pm10', label: 'PM<sub>10</sub>', unit: 'µg/m³' },
    { key: 'so2', label: 'SO₂', unit: 'µg/m³' },
    { key: 'no2', label: 'NO₂', unit: 'µg/m³' },
    { key: 'ch4', label: 'CH₄', unit: 'mg/m³' },
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

  // Prevent page scrolling when touching the chart
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  if (detailChart) detailChart.destroy();

  const std = getAQIStandard();
  const sorted = history.sort((a, b) => a.ts - b.ts);
  const labels = sorted.map((h) => {
    const d = new Date(h.ts * 1000);
    return `${d.getHours()}:00`;
  });

  // Choose correct dataset based on standard
  const values = sorted.map((h) => (std === 'us' ? h.us_aqi || 0 : h.aqi));

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

let dotTooltipEl: HTMLElement | null = null;
let dotSelectedCell: HTMLElement | null = null;

function showDotTooltip(cell: HTMLElement, text: string) {
  if (!dotTooltipEl) {
    dotTooltipEl = document.createElement('div');
    dotTooltipEl.className = 'dot-tooltip';
    document.body.appendChild(dotTooltipEl);
  }
  dotTooltipEl.textContent = text;
  dotTooltipEl.style.display = 'block';
  const r = cell.getBoundingClientRect();
  dotTooltipEl.style.left = `${r.left + r.width / 2}px`;
  dotTooltipEl.style.top = `${r.top - 6}px`;
}

function hideDotTooltip() {
  if (dotTooltipEl) dotTooltipEl.style.display = 'none';
}

export function renderDotsHistory(history: AQIHistory[]) {
  const container = document.getElementById('dots-history');
  if (!container) return;
  container.innerHTML = '';
  dotSelectedCell = null;
  if (!history || history.length === 0) return;

  const std = getAQIStandard();
  const sorted = [...history].sort((a, b) => a.ts - b.ts);

  const fmtHour = (ts: number) => {
    const d = new Date(ts * 1000);
    const hh = d.getHours() < 10 ? '0' + d.getHours() : `${d.getHours()}`;
    return `${hh}:00`;
  };

  const row = document.createElement('div');
  row.className = 'dots-row';
  sorted.forEach((h) => {
    const value = std === 'us' ? h.us_aqi || 0 : h.aqi;
    const cell = document.createElement('div');
    cell.className = 'dot-cell';
    cell.style.backgroundColor = getAQIColor(value, std).hex;
    const label = `AQI ${value}  ·  ${fmtHour(h.ts)}`;
    cell.dataset.label = label;
    cell.addEventListener('mouseenter', () => showDotTooltip(cell, label));
    cell.addEventListener('mouseleave', () => {
      if (dotSelectedCell) showDotTooltip(dotSelectedCell, dotSelectedCell.dataset.label || '');
      else hideDotTooltip();
    });
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dotSelectedCell === cell) {
        dotSelectedCell = null;
        hideDotTooltip();
      } else {
        dotSelectedCell = cell;
        showDotTooltip(cell, label);
      }
    });
    row.appendChild(cell);
  });
  container.appendChild(row);

  const axis = document.createElement('div');
  axis.className = 'dots-axis';
  [0, Math.floor((sorted.length - 1) / 2), sorted.length - 1].forEach((i) => {
    const span = document.createElement('span');
    span.textContent = fmtHour(sorted[i].ts);
    axis.appendChild(span);
  });
  container.appendChild(axis);

  const legend = document.createElement('div');
  legend.className = 'dots-legend';
  const reps = std === 'us' ? [25, 75, 125, 175, 250, 400] : [25, 75, 150, 250, 350, 450];
  const good = document.createElement('span');
  good.textContent = 'Good';
  legend.appendChild(good);
  reps.forEach((rep) => {
    const sw = document.createElement('span');
    sw.className = 'dot-swatch';
    sw.style.backgroundColor = getAQIColor(rep, std).hex;
    legend.appendChild(sw);
  });
  const worst = document.createElement('span');
  worst.textContent = std === 'us' ? 'Hazardous' : 'Severe';
  legend.appendChild(worst);
  container.appendChild(legend);
}

let chartPagerInit = false;

export function setupChartPager() {
  if (chartPagerInit) return;
  const pager = document.getElementById('dashboard-chart-pager');
  if (!pager) return;
  chartPagerInit = true;

  const prev = document.getElementById('chart-arrow-prev');
  const next = document.getElementById('chart-arrow-next');
  const dots = Array.from(document.querySelectorAll<HTMLElement>('#chart-pager-dots .pd'));
  const hint = document.getElementById('chart-swipe-hint');

  const goTo = (page: number) =>
    pager.scrollTo({ left: page * pager.clientWidth, behavior: 'smooth' });
  prev?.addEventListener('click', () => goTo(0));
  next?.addEventListener('click', () => goTo(1));
  dots.forEach((d) => d.addEventListener('click', () => goTo(parseInt(d.dataset.page || '0', 10))));

  const update = () => {
    const page = Math.round(pager.scrollLeft / Math.max(pager.clientWidth, 1));
    dots.forEach((d, i) => d.classList.toggle('active', i === page));
    if (prev) prev.style.visibility = page <= 0 ? 'hidden' : 'visible';
    if (next) next.style.visibility = page >= dots.length - 1 ? 'hidden' : 'visible';
    if (hint) hint.textContent = page === 0 ? 'Swipe for Dots History' : 'Swipe for Trend Graph';
  };
  pager.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.dot-cell')) {
      dotSelectedCell = null;
      hideDotTooltip();
    }
  });
  update();
}

let extendedHistoryChart: LineChart | null = null;

export function renderExtendedHistoryChart(history: any[], showPm25: boolean = true, showPm10: boolean = true) {
  const canvas = document.getElementById('extendedHistoryChart') as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (extendedHistoryChart) extendedHistoryChart.destroy();

  const isDark = getCurrentTheme() === 'dark';
  const lineColor1 = '#a8c7fa';
  const lineColor2 = '#d8b4fe';

  const gradient1 = ctx.createLinearGradient(0, 0, 0, 300);
  gradient1.addColorStop(0, isDark ? 'rgba(168, 199, 250, 0.4)' : 'rgba(65, 105, 225, 0.4)');
  gradient1.addColorStop(1, 'rgba(168, 199, 250, 0.0)');

  const gradient2 = ctx.createLinearGradient(0, 0, 0, 300);
  gradient2.addColorStop(0, isDark ? 'rgba(216, 180, 254, 0.4)' : 'rgba(147, 51, 234, 0.4)');
  gradient2.addColorStop(1, 'rgba(216, 180, 254, 0.0)');

  const labels = history.map(h => {
    const d = new Date(h.ts * 1000);
    const hrs = d.getHours() < 10 ? '0' + d.getHours() : d.getHours();
    return `${d.getDate()}/${d.getMonth()+1} ${hrs}:00`;
  });

  const datasets = [];

  if (showPm25) {
      datasets.push({
          label: 'PM2.5',
          data: history.map(h => h.pm2_5),
          borderColor: lineColor1,
          backgroundColor: gradient1,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 6,
          fill: true,
      });
  }

  if (showPm10) {
      datasets.push({
          label: 'PM10',
          data: history.map(h => h.pm10),
          borderColor: lineColor2,
          backgroundColor: gradient2,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 6,
          fill: true,
      });
  }

  const config: ChartConfiguration<'line', number[], string> = {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { 
        legend: { display: true, labels: { color: isDark ? '#fff' : '#000' } }, 
        tooltip: { enabled: true } 
      },
      scales: { 
        x: { 
            display: true, 
            ticks: { color: isDark ? '#aaa' : '#666', maxTicksLimit: 8 },
            grid: { display: false }
        }, 
        y: { 
            display: true, 
            min: 0, 
            ticks: { color: isDark ? '#aaa' : '#666' }, 
            grid: { color: isDark ? '#333' : '#ddd' },
            title: { display: true, text: 'Concentration (µg/m³)', color: isDark ? '#fff' : '#000' }
        } 
      },
    },
  };

  extendedHistoryChart = new Chart(ctx, config);
}

let extDotSelected: HTMLElement | null = null;

function attachExtCell(cell: HTMLElement, label: string) {
  cell.dataset.label = label;
  cell.addEventListener('mouseenter', () => showDotTooltip(cell, label));
  cell.addEventListener('mouseleave', () => {
    if (extDotSelected) showDotTooltip(extDotSelected, extDotSelected.dataset.label || '');
    else hideDotTooltip();
  });
  cell.addEventListener('click', (e) => {
    e.stopPropagation();
    if (extDotSelected === cell) {
      extDotSelected = null;
      hideDotTooltip();
    } else {
      extDotSelected = cell;
      showDotTooltip(cell, label);
    }
  });
}

interface ExtDay {
  pm25: number[];
  pm10: number[];
  c25: number[];
  c10: number[];
}

export function renderExtendedDotsGrid(history: any[], showPm25: boolean, showPm10: boolean) {
  const container = document.getElementById('extended-dots-grid');
  const subtitle = document.getElementById('extended-dots-subtitle');
  if (!container) return;
  container.innerHTML = '';
  extDotSelected = null;
  if (!history || history.length === 0) return;

  const use25 = showPm25 || (!showPm25 && !showPm10);
  const use10 = showPm10 || (!showPm25 && !showPm10);
  const dayMs = 86400000;

  const byDay = new Map<number, ExtDay>();
  history.forEach((h) => {
    const d = new Date(h.ts * 1000);
    const hour = d.getHours();
    d.setHours(0, 0, 0, 0);
    const dayStart = d.getTime();
    let e = byDay.get(dayStart);
    if (!e) {
      e = {
        pm25: new Array(24).fill(NaN),
        pm10: new Array(24).fill(NaN),
        c25: new Array(24).fill(0),
        c10: new Array(24).fill(0),
      };
      byDay.set(dayStart, e);
    }
    if (h.pm2_5 != null) {
      e.pm25[hour] = isNaN(e.pm25[hour]) ? h.pm2_5 : (e.pm25[hour] * e.c25[hour] + h.pm2_5) / (e.c25[hour] + 1);
      e.c25[hour]++;
    }
    if (h.pm10 != null) {
      e.pm10[hour] = isNaN(e.pm10[hour]) ? h.pm10 : (e.pm10[hour] * e.c10[hour] + h.pm10) / (e.c10[hour] + 1);
      e.c10[hour]++;
    }
  });

  const days = Array.from(byDay.keys()).sort((a, b) => a - b);
  if (days.length === 0) return;
  const hourly = days.length <= 10;

  const cellAqi = (pm25v: number, pm10v: number): number | null => {
    let aqi: number | null = null;
    if (use25 && !isNaN(pm25v)) aqi = calculateUsAqi(pm25v);
    if (use10 && !isNaN(pm10v)) {
      const a = calculateUsAqiPm10(pm10v);
      if (aqi === null || a > aqi) aqi = a;
    }
    return aqi;
  };
  const cellValues = (pm25v: number, pm10v: number): string => {
    const parts: string[] = [];
    if (use25 && !isNaN(pm25v)) parts.push(`PM2.5 ${Math.round(pm25v)}`);
    if (use10 && !isNaN(pm10v)) parts.push(`PM10 ${Math.round(pm10v)}`);
    return parts.join('  ·  ');
  };
  const wd = (ts: number) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });

  const grid = document.createElement('div');

  if (hourly) {
    if (subtitle) subtitle.textContent = 'By Day and Hour  ·  Tap a Cell for Details';
    grid.className = 'ext-grid punch';
    days.forEach((day) => {
      const e = byDay.get(day)!;
      const lbl = document.createElement('div');
      lbl.className = 'ext-glabel';
      lbl.textContent = wd(day);
      grid.appendChild(lbl);
      for (let h = 0; h < 24; h++) {
        const aqi = cellAqi(e.pm25[h], e.pm10[h]);
        const cell = document.createElement('div');
        cell.className = 'ext-cell';
        if (aqi === null) {
          cell.classList.add('empty');
        } else {
          cell.style.backgroundColor = getAQIColor(aqi, 'us').hex;
          const label = `${cellValues(e.pm25[h], e.pm10[h])}  ·  ${wd(day)} ${h < 10 ? '0' + h : h}:00`;
          attachExtCell(cell, label);
        }
        grid.appendChild(cell);
      }
    });
    const corner = document.createElement('div');
    corner.style.gridRow = `${days.length + 1}`;
    corner.style.gridColumn = '1';
    grid.appendChild(corner);
    [0, 6, 12, 18].forEach((h) => {
      const s = document.createElement('div');
      s.className = 'ext-haxis';
      s.textContent = `${h}`;
      s.style.gridRow = `${days.length + 1}`;
      s.style.gridColumn = `${h + 2}`;
      grid.appendChild(s);
    });
  } else {
    if (subtitle) subtitle.textContent = 'Daily Average  ·  Tap a Cell for Details';
    grid.className = 'ext-grid cal';
    const first = new Date(days[0]);
    first.setDate(first.getDate() - first.getDay());
    first.setHours(0, 0, 0, 0);
    const gridStart = first.getTime();
    const numWeeks = Math.floor((days[days.length - 1] - gridStart) / dayMs / 7) + 1;
    grid.style.gridTemplateColumns = `28px repeat(${numWeeks}, minmax(0, 16px))`;

    let lastMonth = '';
    for (let w = 0; w < numWeeks; w++) {
      const m = new Date(gridStart + w * 7 * dayMs).toLocaleDateString(undefined, { month: 'short' });
      if (m !== lastMonth) {
        const s = document.createElement('div');
        s.className = 'ext-month';
        s.textContent = m;
        s.style.gridRow = '1';
        s.style.gridColumn = `${w + 2}`;
        grid.appendChild(s);
        lastMonth = m;
      }
    }
    [1, 3, 5].forEach((row) => {
      const s = document.createElement('div');
      s.className = 'ext-glabel';
      s.textContent = wd(gridStart + row * dayMs);
      s.style.gridRow = `${row + 2}`;
      s.style.gridColumn = '1';
      grid.appendChild(s);
    });

    const cells: HTMLElement[][] = [];
    for (let w = 0; w < numWeeks; w++) {
      cells[w] = [];
      for (let row = 0; row < 7; row++) {
        const c = document.createElement('div');
        c.className = 'ext-cell empty';
        c.style.gridRow = `${row + 2}`;
        c.style.gridColumn = `${w + 2}`;
        grid.appendChild(c);
        cells[w][row] = c;
      }
    }

    const avg = (arr: number[]): number => {
      let s = 0;
      let n = 0;
      for (const x of arr) if (!isNaN(x)) {
        s += x;
        n++;
      }
      return n === 0 ? NaN : s / n;
    };

    days.forEach((day) => {
      const e = byDay.get(day)!;
      const pm25a = avg(e.pm25);
      const pm10a = avg(e.pm10);
      const aqi = cellAqi(pm25a, pm10a);
      if (aqi === null) return;
      const daysSince = Math.floor((day - gridStart) / dayMs);
      const week = Math.floor(daysSince / 7);
      const row = daysSince % 7;
      if (week < 0 || week >= numWeeks || row < 0 || row > 6) return;
      const cell = cells[week][row];
      cell.classList.remove('empty');
      cell.style.backgroundColor = getAQIColor(aqi, 'us').hex;
      const label = `${cellValues(pm25a, pm10a)}  ·  ${new Date(day).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })}`;
      attachExtCell(cell, label);
    });
  }

  container.appendChild(grid);

  const legend = document.createElement('div');
  legend.className = 'dots-legend';
  const good = document.createElement('span');
  good.textContent = 'Good';
  legend.appendChild(good);
  [25, 75, 125, 175, 250, 400].forEach((r) => {
    const sw = document.createElement('span');
    sw.className = 'dot-swatch';
    sw.style.backgroundColor = getAQIColor(r, 'us').hex;
    legend.appendChild(sw);
  });
  const worst = document.createElement('span');
  worst.textContent = 'Hazardous';
  legend.appendChild(worst);
  container.appendChild(legend);
}

let extPagerInit = false;

export function setupExtendedPager() {
  if (extPagerInit) return;
  const pager = document.getElementById('extended-chart-pager');
  if (!pager) return;
  extPagerInit = true;

  const prev = document.getElementById('ext-arrow-prev');
  const next = document.getElementById('ext-arrow-next');
  const dots = Array.from(document.querySelectorAll<HTMLElement>('#ext-pager-dots .pd'));
  const hint = document.getElementById('ext-swipe-hint');

  const goTo = (page: number) =>
    pager.scrollTo({ left: page * pager.clientWidth, behavior: 'smooth' });
  prev?.addEventListener('click', () => goTo(0));
  next?.addEventListener('click', () => goTo(1));
  dots.forEach((d) => d.addEventListener('click', () => goTo(parseInt(d.dataset.page || '0', 10))));

  const update = () => {
    const page = Math.round(pager.scrollLeft / Math.max(pager.clientWidth, 1));
    dots.forEach((d, i) => d.classList.toggle('active', i === page));
    if (prev) prev.style.visibility = page <= 0 ? 'hidden' : 'visible';
    if (next) next.style.visibility = page >= dots.length - 1 ? 'hidden' : 'visible';
    if (hint) hint.textContent = page === 0 ? 'Swipe for Dots History' : 'Swipe for Trend Graph';
  };
  pager.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.ext-cell')) {
      extDotSelected = null;
      hideDotTooltip();
    }
  });
  update();
}

export function updateExtendedChartTheme() {
    if (extendedHistoryChart) {
        // Redraw
        extendedHistoryChart.update();
    }
}
