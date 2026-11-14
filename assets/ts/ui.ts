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
  makeActivatable,
  animateCount,
  setAQIStandard,
  aqiTextColor,
  getHealthAdvice,
} from './utils.js';
import { Zone, AQIData, AQIHistory, Pollutants, WeatherInfo, SensorInfo } from './types.js';
import {
  historyAqi,
  isDistrictAverage,
  isEstimate,
  isRawMode,
  placeLine,
  rawApplies,
  rawExplainerHtml,
  zoneAqi,
  zoneAverages,
  zoneConcentrations,
  zoneMainPollutant,
  zoneReadings,
} from './readings.js';
import { getSensorInfoList } from './api.js';
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

export function getPinIconStack(isPinned: boolean, small: boolean = false): string {
  const classes = ['pin-icon'];
  if (isPinned) {
    classes.push('pinned');
  }
  if (small) {
    classes.push('small');
  }
  return `<span class="${classes.join(' ')}">${UNPINNED_ICON}${PINNED_ICON}</span>`;
}

export function setPinIcon(host: HTMLElement, isPinned: boolean, small: boolean = false): void {
  const existing = host.querySelector('.pin-icon');
  if (existing) {
    existing.classList.toggle('pinned', isPinned);
    return;
  }
  host.innerHTML = getPinIconStack(isPinned, small);
}

function getTrendHTML(currentAqi: number, currentTs: number, history: AQIHistory[]): string {
  if (!history || history.length === 0) return '';
  const oneHourAgo = currentTs - 3600;
  const std = getAQIStandard();

  const validHistory = history.filter(
    (h) => Math.abs(h.ts - oneHourAgo) < 1800 && historyAqi(h, std) !== null
  );
  if (validHistory.length === 0) return '';

  validHistory.sort((a, b) => Math.abs(a.ts - oneHourAgo) - Math.abs(b.ts - oneHourAgo));
  const pastEntry = validHistory[0];

  const pastVal = historyAqi(pastEntry, std) as number;
  const diff = currentAqi - pastVal;

  if (diff === 0) {
    return (
      '<span class="trend-badge flat"><span class="trend-arrow">↑</span>' +
      '<span class="trend-delta">--</span> /hr</span>'
    );
  }
  const isRising = diff > 0;
  const sign = isRising ? '+' : '';
  const colorClass = isRising ? 'worsening' : 'improving';
  return (
    `<span class="trend-badge ${colorClass}"><span class="trend-arrow">↑</span>` +
    `<span class="trend-delta">${sign}${diff}</span> /hr</span>`
  );
}

// Reuses the badge so the arrow rotates between the three states and the
// delta counts, rather than one glyph being swapped for another.
export function updateTrendBadge(
  host: HTMLElement,
  currentAqi: number,
  currentTs: number,
  history: AQIHistory[]
): void {
  const markup = getTrendHTML(currentAqi, currentTs, history);
  const existing = host.querySelector('.trend-badge') as HTMLElement | null;

  if (!markup || !existing) {
    host.innerHTML = markup;
    return;
  }

  const parsed = document.createElement('div');
  parsed.innerHTML = markup;
  const next = parsed.firstElementChild as HTMLElement | null;
  if (!next) {
    host.innerHTML = markup;
    return;
  }

  existing.className = next.className;

  const currentDelta = existing.querySelector('.trend-delta') as HTMLElement | null;
  const nextDelta = next.querySelector('.trend-delta');
  const to = nextDelta ? parseInt(nextDelta.textContent || '', 10) : NaN;

  if (!currentDelta || isNaN(to)) {
    existing.innerHTML = next.innerHTML;
    return;
  }

  animateCount(currentDelta, to, (n) => (n > 0 ? `+${n}` : String(n)));
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

const HEART_PATH =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

export function renderHealthAdviceCard(aqi: number, std: 'india' | 'us'): string {
  const advice = getHealthAdvice(aqi, std);
  const color = getAQIColor(aqi, std).hex;
  return `
    <div class="cigarette-card advice-card" style="--aqi-color: ${color};">
      <div class="cigarette-icon advice-icon">
        <svg viewBox="0 0 24 24"><path d="${HEART_PATH}"/></svg>
      </div>
      <div class="cigarette-content">
        <div class="cigarette-value">${advice.title}</div>
        <div class="cigarette-label">${advice.text}</div>
      </div>
    </div>
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
// A reading older than this is no longer live. AirGradient zones report every
// fifteen minutes, and coverage across the network runs as low as 69%, so a
// silent sensor is common enough to be worth showing.
const STALE_AFTER_MINUTES = 30;

export function minutesSince(timestampUnix: number): number {
  return Math.floor(Date.now() / 1000 - timestampUnix) / 60;
}

export function markStale(el: HTMLElement, timestampUnix: number): boolean {
  const stale = minutesSince(timestampUnix) > STALE_AFTER_MINUTES;
  el.classList.toggle('stale', stale);
  return stale;
}

export function renderDashboardCard(
  zone: Zone,
  data: AQIData,
  onClick: () => void,
  index: number = 0,
  animate: boolean = true
): HTMLElement {
  const std = getAQIStandard();
  const displayAqi = zoneAqi(data, std);
  const colors = getAQIColor(displayAqi, std);

  const card = document.createElement('div');
  card.className = 'dashboard-card';
  if (animate) {
    card.style.animationDelay = `calc(${Math.min(index, 7)} * var(--list-stagger))`;
  } else {
    card.classList.add('no-entrance');
  }
  card.onclick = onClick;
  markStale(card, data.timestamp_unix);
  makeActivatable(card);
  const sparkValues = [...(data.history || [])]
    .sort((a, b) => a.ts - b.ts)
    .map((h) => historyAqi(h, std))
    .filter((v): v is number => v !== null);
  const district = zone.district ? `<p class="dash-place">${zone.district} district</p>` : '';
  card.innerHTML = `
        <div class="dash-info">
            <h3 class="dash-name">${zone.name}</h3>
            ${district}
            <p class="dash-meta">
                <span style="color: ${colors.hex};">${getAQICategory(displayAqi, std)}</span>
                <span class="dash-dot">·</span>
                ${formatPollutantName(zoneMainPollutant(data))}
            </p>
            ${getTrendHTML(displayAqi, data.timestamp_unix, data.history)}
        </div>
        ${sparklineSvg(sparkValues, colors.hex)}
        <div class="aqi-badge-small" style="background-color: ${colors.hex}; color: ${aqiTextColor(displayAqi, std)};">
            ${displayAqi}
        </div>
    `;
  return card;
}

export function sparklineSvg(values: number[], color: string): string {
  if (values.length < 2) {
    return '';
  }
  const width = 96;
  const height = 32;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - 3 - (v / max) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${points.join(' L')}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  return `
    <svg class="dash-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${area}" fill="${color}" opacity="0.14"></path>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
    </svg>
  `;
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

// details
const LIVE_SOURCE_HTML = '<span class="live-dot"></span> Live ground sensor';

function sourceIndicatorHtml(zone: Zone, data: AQIData): { html: string; muted: boolean } {
  if (isEstimate(zone)) {
    return { html: 'Satellite estimate, no sensor here yet', muted: true };
  }
  if (data.source && data.source.startsWith('openmeteo')) {
    return { html: 'Sensor offline, showing a satellite estimate', muted: true };
  }
  if (isDistrictAverage(zone)) {
    return { html: '<span class="live-dot"></span> Live ground sensors', muted: false };
  }
  if (rawApplies(data)) {
    return { html: `${LIVE_SOURCE_HTML} · raw readings`, muted: false };
  }
  return { html: LIVE_SOURCE_HTML, muted: false };
}

export function updateDetailView(zone: Zone, data: AQIData) {
  const titleHeader = document.getElementById('detail-title-header');
  if (titleHeader) titleHeader.innerText = zone.name;

  const std = getAQIStandard();
  const displayAqi = zoneAqi(data, std);
  const colors = getAQIColor(displayAqi, std);
  const category = getAQICategory(displayAqi, std);
  const barPosition = getAQIBarPosition(displayAqi, std);

  const zoneNameEl = document.getElementById('detail-zone-name');
  const placeLineEl = document.getElementById('detail-place-line');
  const sourceIndicatorEl = document.getElementById('detail-source-indicator');

  const aqiEl = document.getElementById('detail-aqi');
  const chipEl = document.getElementById('detail-standard-chip') as HTMLElement;
  const primaryEl = document.getElementById('detail-primary');
  const updatedEl = document.getElementById('detail-updated');
  const trendEl = document.getElementById('detail-trend');
  const providerContainer = document.getElementById('detail-provider');
  const cigaretteContainer = document.getElementById('cigarette-card-container');
  const mainCard = document.getElementById('detail-main-card');

  const aqiBarLabel = document.getElementById('aqi-bar-label');
  const aqiBar = document.getElementById('aqi-bar');
  const aqiBarIndicator = document.getElementById('aqi-bar-indicator');

  if (zoneNameEl) zoneNameEl.innerText = zone.name;

  if (placeLineEl) {
    const line = placeLine(zone);
    placeLineEl.textContent = line;
    placeLineEl.classList.toggle('hidden', !line);
    placeLineEl.dataset.district = zone.district || '';
  }

  if (sourceIndicatorEl) {
    const source = sourceIndicatorHtml(zone, data);
    sourceIndicatorEl.innerHTML = source.html;
    sourceIndicatorEl.style.color = source.muted ? 'var(--on-surface-variant)' : '';
    sourceIndicatorEl.style.display = 'flex';
  }

  renderRawControls(zone, data);

  const btnHistory = document.getElementById('btn-extended-history');
  if (btnHistory) {
    btnHistory.style.display = isEstimate(zone) ? 'none' : 'block';
  }

  if (mainCard) {
    mainCard.style.setProperty('--aqi-color', colors.hex);
    markStale(mainCard, data.timestamp_unix);
  }

  const warningEl = document.getElementById('detail-warning');
  if (data.warning && warningEl) {
    warningEl.innerHTML = `
      <div class="detail-warning-box">
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="var(--aqi-very-poor)"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
          <div>${data.warning}</div>
      </div>
    `;
  } else if (warningEl) {
    warningEl.innerHTML = '';
  }

  if (aqiEl) {
    animateCount(aqiEl, displayAqi);
    aqiEl.style.color = colors.hex;
  }

  const headerAqiEl = document.getElementById('detail-header-aqi');
  if (headerAqiEl) {
    animateCount(headerAqiEl, displayAqi);
    headerAqiEl.style.color = colors.hex;
  }

  if (chipEl) {
    chipEl.style.backgroundColor = colors.hex;
    chipEl.style.color = aqiTextColor(displayAqi, std);
    const label = std === 'us' ? 'US AQI' : 'NAQI';
    chipEl.innerText = rawApplies(data) ? `Raw ${label}` : label;
    chipEl.setAttribute('role', 'button');
    chipEl.setAttribute('tabindex', '0');
    chipEl.setAttribute('title', 'Switch AQI standard');
    chipEl.onclick = () => setAQIStandard(std === 'us' ? 'india' : 'us');
  }

  if (primaryEl) primaryEl.innerHTML = formatPollutantName(zoneMainPollutant(data));

  if (trendEl) {
    updateTrendBadge(trendEl, displayAqi, data.timestamp_unix, data.history);
  }

  if (updatedEl) {
    const diff = Math.round(minutesSince(data.timestamp_unix));
    updatedEl.innerText = `${diff}m ago`;
    updatedEl.classList.toggle('stale-label', diff > STALE_AFTER_MINUTES);
  }

  if (aqiBarLabel) {
    aqiBarLabel.innerText = category;
    aqiBarLabel.style.color = colors.hex;
  }

  if (aqiBar) {
    aqiBar.classList.toggle('aqi-bar-us', std === 'us');
  }

  if (aqiBarIndicator) {
    aqiBarIndicator.style.left = `${barPosition}%`;
  }

  const adviceContainer = document.getElementById('health-advice-container');
  if (adviceContainer) {
    adviceContainer.innerHTML = renderHealthAdviceCard(displayAqi, std);
  }

  if (cigaretteContainer) {
    const averages = zoneAverages(data);
    const pm25 = averages?.['pm2_5'] || zoneConcentrations(data)['pm2_5'] || 0;
    cigaretteContainer.innerHTML = renderCigaretteCard(pm25);
  }

  if (providerContainer) {
    if (!isEstimate(zone)) {
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

  renderWeatherCard(data.weather);
  renderPollutantGrid(zoneConcentrations(data));
  renderSensorCard(zone, data);

  const trendTitle = document.getElementById('chart-mode-label');
  if (trendTitle) {
    trendTitle.textContent = rawApplies(data) ? 'Raw readings' : '';
  }

  renderChart(data.history);
  renderDotsHistory(data.history);
  setupChartPager();
}

function renderRawControls(zone: Zone, data: AQIData) {
  const switcher = document.getElementById('detail-raw-switch');
  const banner = document.getElementById('detail-raw-banner');
  const unavailable = document.getElementById('detail-raw-unavailable');
  const estimate = isEstimate(zone);
  const hasRaw = !!data.raw;

  if (switcher) {
    switcher.classList.toggle('hidden', estimate || isDistrictAverage(zone));
    switcher.querySelectorAll<HTMLButtonElement>('[data-raw-choice]').forEach((btn) => {
      if (btn.dataset.rawChoice === 'raw') {
        btn.disabled = !hasRaw;
      }
    });
  }

  if (banner) {
    const show = rawApplies(data);
    banner.classList.toggle('hidden', !show);
    const body = banner.querySelector('.raw-banner-points');
    if (body && !body.innerHTML) {
      body.innerHTML = rawExplainerHtml();
    }
  }

  if (unavailable) {
    let text = '';
    if (isRawMode() && isDistrictAverage(zone)) {
      text = 'Raw readings are switched on, but district averages only come calibrated.';
    } else if (isRawMode() && !estimate && !hasRaw) {
      text =
        'Raw readings are switched on, but this sensor has no live reading to show raw, so these are the calibrated satellite numbers.';
    } else if (isRawMode() && estimate) {
      text = 'Raw readings are switched on, but there is no sensor here, so nothing changes.';
    }
    unavailable.textContent = text;
    unavailable.classList.toggle('hidden', !text);
  }
}

let sensorInfoCache: SensorInfo[] | null = null;

async function renderSensorCard(zone: Zone, data: AQIData) {
  const container = document.getElementById('sensor-card-container');
  if (!container) return;

  if (isEstimate(zone) || isDistrictAverage(zone)) {
    container.innerHTML = '';
    return;
  }

  const readings = zoneReadings(data);
  const raw = rawApplies(data);
  const fmt = (value: number | null | undefined, unit: string) =>
    value === null || value === undefined ? '--' : `${Math.round(value * 10) / 10}${unit}`;

  const readingRows = readings
    ? `
      <div class="sensor-readings">
        <div class="sensor-reading">
          <span class="sensor-reading-label">Temperature${raw ? ' (raw)' : ''}</span>
          <span class="sensor-reading-value">${fmt(readings.temp, ' °C')}</span>
        </div>
        <div class="sensor-reading">
          <span class="sensor-reading-label">Humidity${raw ? ' (raw)' : ''}</span>
          <span class="sensor-reading-value">${fmt(readings.humidity, '%')}</span>
        </div>
        <div class="sensor-reading">
          <span class="sensor-reading-label">PM<sub>2.5</sub>${raw ? ' (raw)' : ''}</span>
          <span class="sensor-reading-value">${fmt(readings.pm2_5, ' µg/m³')}</span>
        </div>
        <div class="sensor-reading">
          <span class="sensor-reading-label">PM<sub>10</sub>${raw ? ' (raw)' : ''}</span>
          <span class="sensor-reading-value">${fmt(readings.pm10, ' µg/m³')}</span>
        </div>
      </div>
    `
    : '';

  const render = (info: SensorInfo | null) => {
    const facts = [
      ['Provider', info?.provider || 'AirGradient'],
      ['Model', info?.model || '--'],
      ['Location ID', String(data.location_id ?? info?.location_id ?? '--')],
      ['Installed', info?.installation_date || '--'],
    ];
    container.innerHTML = `
      <div class="pollutants-container-card sensor-card">
        <h3 class="section-title">About this sensor</h3>
        ${readingRows}
        <dl class="sensor-facts">
          ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
        </dl>
      </div>
    `;
  };

  const match = (list: SensorInfo[] | null) =>
    list?.find((s) => s.location_id === data.location_id) ?? null;

  render(match(sensorInfoCache));
  if (!sensorInfoCache) {
    sensorInfoCache = await getSensorInfoList();
    render(match(sensorInfoCache));
  }
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
    { key: 'pm2_5', label: 'PM<sub>2.5</sub>', unit: 'µg/m³', who: 15 },
    { key: 'co', label: 'CO', unit: 'mg/m³', who: 4 },
    { key: 'pm10', label: 'PM<sub>10</sub>', unit: 'µg/m³', who: 45 },
    { key: 'so2', label: 'SO₂', unit: 'µg/m³', who: 40 },
    { key: 'no2', label: 'NO₂', unit: 'µg/m³', who: 25 },
    { key: 'ch4', label: 'CH₄', unit: 'mg/m³', who: 0 },
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
                ${def.who > 0 ? renderWhoMeter(comps[def.key], def.who, def.unit) : ''}
            `;
      container.appendChild(div);
    }
  });
}

export function whoRatioColor(ratio: number): string {
  if (ratio <= 1) {
    return 'var(--aqi-good)';
  }
  if (ratio <= 2) {
    return 'var(--aqi-moderate)';
  }
  if (ratio <= 4) {
    return 'var(--aqi-poor)';
  }
  return 'var(--aqi-very-poor)';
}

function renderWhoMeter(value: number, limit: number, unit: string): string {
  const ratio = value / limit;
  const color = whoRatioColor(ratio);
  const fill = Math.min(ratio / 5, 1) * 100;
  const mark = (1 / 5) * 100;
  const text =
    ratio <= 1
      ? `Within WHO guideline of ${limit} ${unit}`
      : `${ratio.toFixed(1)}× WHO 24h guideline`;
  return `
    <div class="who-meter" title="WHO 2021 24 hour guideline is ${limit} ${unit}">
      <div class="who-track">
        <div class="who-fill" style="width: ${fill}%; background: ${color};"></div>
        <div class="who-mark" style="left: ${mark}%;"></div>
      </div>
      <span class="who-text" style="color: ${color};">${text}</span>
    </div>
  `;
}

export function updateChartTheme() {
  if (detailChart) detailChart.update();
}

const WEATHER_CLOUD_PATH =
  'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z';
const WEATHER_SUN_PATH =
  'M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z';

function weatherIconSvg(condition: string, color: string): string {
  const path = condition === 'clear' ? WEATHER_SUN_PATH : WEATHER_CLOUD_PATH;
  return `<svg viewBox="0 0 24 24" style="fill: ${color};"><path d="${path}"/></svg>`;
}

const SEASON_LABELS: { [key: string]: string } = {
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
  monsoon: 'Monsoon',
  autumn: 'Autumn',
};

const SEASON_TEXTS: { [key: string]: string } = {
  winter:
    'Cold air and heating smoke get trapped near the ground. This is typically the worst stretch of the year.',
  spring: 'Air quality improves as temperatures rise and spring rains pick up.',
  summer: 'Warm, drier air keeps pollution at moderate levels.',
  monsoon: 'Rain washes particulates out of the air. Usually the cleanest time of the year.',
  autumn: 'Dry weather and seasonal burning can push particulate levels back up.',
};

export function renderWeatherCard(weather?: WeatherInfo) {
  const container = document.getElementById('weather-card-container');
  if (!container) return;

  if (!weather || !weather.text) {
    container.innerHTML = '';
    return;
  }

  const isSmog = weather.condition === 'smog';
  const season = SEASON_LABELS[weather.season] || weather.season;
  const text = SEASON_TEXTS[weather.season] || weather.text;
  const iconBg = isSmog
    ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.12) 100%)'
    : 'linear-gradient(135deg, rgba(148, 163, 184, 0.2) 0%, rgba(148, 163, 184, 0.12) 100%)';
  const iconColor = isSmog ? 'var(--aqi-poor)' : 'var(--on-surface-variant)';

  container.innerHTML = `
    <div class="cigarette-card">
      <div class="cigarette-icon" style="background: ${iconBg}; box-shadow: none;">
        ${weatherIconSvg(weather.condition, iconColor)}
      </div>
      <div class="cigarette-content">
        <div class="cigarette-value" style="text-transform: capitalize;">${weather.condition} · ${season}</div>
        <div class="cigarette-label">${text}</div>
      </div>
    </div>
  `;
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
    const hour = d.getHours() < 10 ? `0${d.getHours()}` : `${d.getHours()}`;
    return `${hour}:00`;
  });

  const values = sorted.map((h) => historyAqi(h, std));
  const present = values.filter((v): v is number => v !== null);
  const peak = present.length > 0 ? Math.max(...present) : 0;
  const breakpoints = aqiBreakpoints(std);
  const topBand = Math.max(Math.ceil((peak * 1.15) / 10) * 10, 60);

  const isDark = getCurrentTheme() === 'dark';
  const tickColor = isDark ? '#9aa0aa' : '#64748b';
  const peakColor = getAQIColor(peak, std).hex;

  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, hexToRgba(peakColor, 0.28));
  gradient.addColorStop(1, hexToRgba(peakColor, 0));

  const config: ChartConfiguration<'line', number[], string> = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          data: values as unknown as number[],
          borderColor: peakColor,
          backgroundColor: gradient,
          borderWidth: 2.5,
          tension: 0.4,
          pointRadius: (c) => {
            const before = values[c.dataIndex - 1];
            const after = values[c.dataIndex + 1];
            if (values[c.dataIndex] === null) {
              return 0;
            }
            if (
              (before === null || before === undefined) &&
              (after === null || after === undefined)
            ) {
              return 3;
            }
            return 0;
          },
          pointBackgroundColor: (c) => getAQIColor(Number(c.raw) || 0, std).hex,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: (c) => getAQIColor(Number(c.raw) || 0, std).hex,
          fill: true,
          segment: {
            borderColor: (c) =>
              getAQIColor(Math.max(c.p0.parsed.y ?? 0, c.p1.parsed.y ?? 0), std).hex,
          },
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          displayColors: false,
          callbacks: {
            label: (c) => {
              const value = Number(c.raw) || 0;
              return `AQI ${value}  ·  ${getAQICategory(value, std)}`;
            },
          },
        },
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          border: { display: false },
          ticks: { color: tickColor, maxTicksLimit: 6, maxRotation: 0, font: { size: 11 } },
        },
        y: {
          display: true,
          min: 0,
          max: topBand,
          position: 'right',
          border: { display: false, dash: [3, 4] },
          grid: {
            color: (c) => hexToRgba(getAQIColor(c.tick.value, std).hex, 0.35),
            drawTicks: false,
          },
          ticks: { color: tickColor, padding: 6, font: { size: 11 } },
          afterBuildTicks: (axis) => {
            axis.ticks = breakpoints.filter((b) => b <= topBand).map((b) => ({ value: b }));
          },
        },
      },
      layout: { padding: { top: 4 } },
    },
  };

  detailChart = new Chart(ctx, config);
}

export function aqiBreakpoints(std: 'india' | 'us'): number[] {
  if (std === 'us') {
    return [50, 100, 150, 200, 300, 500];
  }
  return [50, 100, 200, 300, 400, 500];
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) {
    return hex;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

let dotTooltipEl: HTMLElement | null = null;
let dotSelectedCell: HTMLElement | null = null;

function showDotTooltip(cell: HTMLElement, text: string) {
  if (!dotTooltipEl) {
    dotTooltipEl = document.createElement('div');
    dotTooltipEl.className = 'dot-tooltip';
    document.body.appendChild(dotTooltipEl);
  }
  // Only glide between positions if it is already on screen, otherwise it
  // would fly in from wherever the last hovered cell happened to be.
  const wasVisible = dotTooltipEl.classList.contains('visible');
  dotTooltipEl.classList.toggle('travelling', wasVisible);

  dotTooltipEl.textContent = text;
  const r = cell.getBoundingClientRect();
  dotTooltipEl.style.left = `${r.left + r.width / 2}px`;
  dotTooltipEl.style.top = `${r.top - 6}px`;
  dotTooltipEl.classList.add('visible');
}

function hideDotTooltip() {
  if (dotTooltipEl) dotTooltipEl.classList.remove('visible', 'travelling');
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
    const value = historyAqi(h, std);
    const cell = document.createElement('div');
    cell.className = 'dot-cell';
    if (value === null) {
      cell.classList.add('empty');
      row.appendChild(cell);
      return;
    }
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
        dotSelectedCell.classList.remove('selected');
        dotSelectedCell = null;
        hideDotTooltip();
      } else {
        if (dotSelectedCell) dotSelectedCell.classList.remove('selected');
        dotSelectedCell = cell;
        dotSelectedCell.classList.add('selected');
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

function setArrowAvailable(arrow: HTMLElement | null, available: boolean) {
  if (!arrow) {
    return;
  }
  arrow.classList.toggle('unavailable', !available);
  arrow.tabIndex = available ? 0 : -1;
  arrow.setAttribute('aria-hidden', available ? 'false' : 'true');
}

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
    setArrowAvailable(prev, page > 0);
    setArrowAvailable(next, page < dots.length - 1);
    if (hint) hint.textContent = page === 0 ? 'Swipe for Dots History' : 'Swipe for Trend Graph';
  };
  pager.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.dot-cell')) {
      if (dotSelectedCell) dotSelectedCell.classList.remove('selected');
      dotSelectedCell = null;
      hideDotTooltip();
    }
  });
  update();
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
      extDotSelected.classList.remove('selected');
      extDotSelected = null;
      hideDotTooltip();
    } else {
      if (extDotSelected) extDotSelected.classList.remove('selected');
      extDotSelected = cell;
      extDotSelected.classList.add('selected');
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

export function renderExtendedDotsGrid(
  history: any[],
  showPm25: boolean,
  showPm10: boolean,
  target?: HTMLElement,
  subtitleTarget?: HTMLElement | null
) {
  const container = target ?? document.getElementById('extended-dots-grid');
  const subtitle =
    subtitleTarget !== undefined
      ? subtitleTarget
      : document.getElementById('extended-dots-subtitle');
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
      e.pm25[hour] = isNaN(e.pm25[hour])
        ? h.pm2_5
        : (e.pm25[hour] * e.c25[hour] + h.pm2_5) / (e.c25[hour] + 1);
      e.c25[hour]++;
    }
    if (h.pm10 != null) {
      e.pm10[hour] = isNaN(e.pm10[hour])
        ? h.pm10
        : (e.pm10[hour] * e.c10[hour] + h.pm10) / (e.c10[hour] + 1);
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
      const m = new Date(gridStart + w * 7 * dayMs).toLocaleDateString(undefined, {
        month: 'short',
      });
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
      for (const x of arr)
        if (!isNaN(x)) {
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

export function clearExtendedSelection(): void {
  if (extDotSelected) extDotSelected.classList.remove('selected');
  extDotSelected = null;
  hideDotTooltip();
}
