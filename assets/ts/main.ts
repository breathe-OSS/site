import { STORAGE_KEY_PINS, API_URL } from './config.js';
import { fetchZones, getZoneAQI } from './api.js';
import { initTheme, initStandard } from './utils.js';
import { initMap, updateMapTiles, resizeMap, getCurrentMapZoneId } from './map.js';
import {
  renderDashboardCard,
  renderExploreItem,
  updateDetailView,
  updateChartTheme,
  renderSkeletonCard,
  getPinIcon,
} from './ui.js';
import { Zone, AQIData, WeatherHistory } from './types.js';

let allZones: Zone[] = [];
let pinnedZoneIds: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY_PINS) || '[]');

// init
document.addEventListener('DOMContentLoaded', async () => {
  initTheme((newTheme) => {
    updateMapTiles(newTheme);
    updateChartTheme();
  });

  initStandard((newStd) => {
    // Redraw current view on standard change
    refreshDashboard();

    // If in detail view, refresh it
    const detailView = document.getElementById('view-details');
    if (detailView && detailView.classList.contains('active-view')) {
      // Find which zone is currently open from DOM or state
      const title = document.getElementById('detail-title-header')?.innerText;
      const zone = allZones.find((z) => z.name === title);
      if (zone) openDetails(zone.id);
    }

    // If in map view, refresh markers
    if (document.getElementById('view-map')?.classList.contains('active-view')) {
      initMap(allZones);
    }
  });

  allZones = await fetchZones();
  refreshDashboard();

  updateNavHighlight('dashboard');

  // Listen for custom event from map detail sheet
  window.addEventListener('openDetails', (e: Event) => {
    const customEvent = e as CustomEvent;
    if (customEvent.detail && customEvent.detail.zoneId) {
      openDetails(customEvent.detail.zoneId);
    }
  });

  const searchInput = document.getElementById('zone-search') as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      refreshExploreList(target.value);
    });
  }
});

// controller actions

async function refreshDashboard() {
  const container = document.getElementById('pinned-container');
  const emptyState = document.getElementById('empty-state');
  if (!container || !emptyState) return;

  container.innerHTML = '';

  if (pinnedZoneIds.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  // Show skeleton loaders immediately
  const skeletons = Array.from({ length: Math.min(pinnedZoneIds.length, 4) }, () =>
    renderSkeletonCard()
  );
  container.append(...skeletons);

  // Fetch all data in parallel
  const dataPromises = pinnedZoneIds.map(async (id) => {
    const zone = allZones.find((z) => z.id === id);
    if (!zone) return null;
    const data = await getZoneAQI(id);
    if (!data) return null;
    return { zone, data };
  });

  const results = await Promise.all(dataPromises);

  // Create all cards in memory first (no DOM operations yet)
  const cards = results
    .filter((result): result is { zone: Zone; data: AQIData } => result !== null)
    .map((result, index) =>
      renderDashboardCard(result.zone, result.data, () => openDetails(result.zone.id), index)
    );

  // Replace all skeletons with actual cards in a single operation
  container.innerHTML = '';
  container.append(...cards);
}

function refreshExploreList(filter: string = '') {
  const container = document.getElementById('zone-list');
  if (!container) return;
  container.innerHTML = '';

  const filtered = allZones.filter((z) => z.name.toLowerCase().includes(filter.toLowerCase()));

  filtered.forEach((zone) => {
    const isPinned = pinnedZoneIds.includes(zone.id);
    const card = renderExploreItem(zone, isPinned, () => togglePin(zone.id));
    container.appendChild(card);
  });
}

function togglePin(id: string) {
  if (pinnedZoneIds.includes(id)) {
    pinnedZoneIds = pinnedZoneIds.filter((zid) => zid !== id);
  } else {
    pinnedZoneIds.push(id);
  }
  localStorage.setItem(STORAGE_KEY_PINS, JSON.stringify(pinnedZoneIds));
  refreshDashboard();
}

let currentZoneId: string | null = null;

async function openDetails(zoneId: string) {
  currentZoneId = zoneId;
  handleShowView('details');
  const zone = allZones.find((z) => z.id === zoneId);
  if (!zone) return;

  const data = await getZoneAQI(zoneId);
  if (data) {
    updateDetailView(zone, data);
  }
}

import { getSensorInfoList } from './api.js';

async function openNodeDetails(
  nodeName: string,
  std: string,
  displayAqi: number,
  temp: number,
  humidity: number,
  pm25: number,
  pm10: number
) {
  const sheet = document.getElementById('node-detail-sheet');
  const title = document.getElementById('node-sheet-title');
  const aqiEl = document.getElementById('node-sheet-aqi');
  const stdEl = document.getElementById('node-sheet-std');
  const pm25El = document.getElementById('node-sheet-pm25');
  const pm10El = document.getElementById('node-sheet-pm10');
  const tempEl = document.getElementById('node-sheet-temp');
  const humidEl = document.getElementById('node-sheet-humid');
  const providerEl = document.getElementById('node-sheet-provider');
  const modelEl = document.getElementById('node-sheet-model');
  const locidEl = document.getElementById('node-sheet-locid');
  const installEl = document.getElementById('node-sheet-install');

  if (!sheet || !title) return;

  title.innerText = nodeName;

  if (aqiEl) aqiEl.innerText = displayAqi.toString();
  if (stdEl) stdEl.innerText = std === 'us' ? 'US AQI' : 'NAQI';

  if (pm25El) pm25El.innerText = `${pm25} µg/m³`;
  if (pm10El) pm10El.innerText = `${pm10} µg/m³`;
  if (tempEl) tempEl.innerText = `${temp} °C`;
  if (humidEl) humidEl.innerText = `${humidity}%`;

  const sensors = await getSensorInfoList();
  const info = sensors ? sensors.find((s: any) => s.name === nodeName) : null;

  if (info) {
    if (providerEl) providerEl.innerText = info.provider || '--';
    if (modelEl) modelEl.innerText = info.model || '--';
    if (locidEl) locidEl.innerText = info.location_id?.toString() || '--';
    if (installEl) installEl.innerText = info.installation_date || '--';
  } else {
    if (providerEl) providerEl.innerText = '--';
    if (modelEl) modelEl.innerText = '--';
    if (locidEl) locidEl.innerText = '--';
    if (installEl) installEl.innerText = '--';
  }

  sheet.classList.remove('hidden');
}

let currentHistoryZoneId: string | null = null;
let currentHistoryRange: string = '1w';

import { fetchHistoricalData, fetchWeatherHistory } from './api.js';
import { renderExtendedHistoryChart, renderExtendedDotsGrid, setupExtendedPager } from './ui.js';

let currentHistoryData: any = null;
let currentWeatherData: WeatherHistory | null = null;
let currentWeatherFilter: string = 'all';

async function openHistoryView() {
  if (!currentZoneId) return;
  const zone = allZones.find((z) => z.id === currentZoneId);
  if (!zone) return;

  currentHistoryZoneId = zone.id;
  const histTitle = document.getElementById('history-title-header');
  if (histTitle) histTitle.innerText = `${zone.name} History`;

  const aqiData = await getZoneAQI(zone.id);
  const sensorSelect = document.getElementById('hist-sensor-select') as HTMLSelectElement;
  if (sensorSelect) {
    sensorSelect.innerHTML = '<option value="zone">Zone Average</option>';
    if (aqiData && aqiData.nodes) {
      Object.keys(aqiData.nodes).forEach((node) => {
        sensorSelect.innerHTML += `<option value="${node}">${node}</option>`;
      });
    }
  }

  handleShowView('history');
  currentHistoryData = null;
  currentWeatherData = null;
  setWeatherFilter('all');
  setHistoryRange('1w');
}

function setWeatherFilter(condition: string) {
  currentWeatherFilter = condition;
  document
    .querySelectorAll('#weather-filter-chips .btn-outlined')
    .forEach((btn) => btn.classList.remove('active'));
  const btn = document.getElementById(`wf-${condition}`);
  if (btn) {
    btn.classList.add('active');
  }
  renderFilteredHistory();
}

function conditionForTs(ts: number): string | null {
  if (!currentWeatherData || currentWeatherData.points.length === 0) {
    return null;
  }
  const interval = currentWeatherData.interval;
  const bucket = Math.floor(ts / interval) * interval;
  const point = currentWeatherData.points.find((p) => p.ts === bucket);
  return point ? point.condition : null;
}

function matchesFilter(condition: string | null, filter: string): boolean {
  if (filter === 'all') {
    return true;
  }
  if (condition === null) {
    return false;
  }
  if (filter === 'rain') {
    return condition === 'rain' || condition === 'thunderstorm';
  }
  return condition === filter;
}

function renderFilteredHistory() {
  if (!currentHistoryData) {
    return;
  }

  const pm25Cb = document.getElementById('hist-pm25') as HTMLInputElement;
  const pm10Cb = document.getElementById('hist-pm10') as HTMLInputElement;
  const showPm25 = pm25Cb ? pm25Cb.checked : true;
  const showPm10 = pm10Cb ? pm10Cb.checked : true;

  let points = currentHistoryData.data || [];
  if (currentWeatherFilter !== 'all') {
    points = points.filter((p: any) => matchesFilter(conditionForTs(p.ts), currentWeatherFilter));
  }

  renderExtendedHistoryChart(points, showPm25, showPm10);
  renderExtendedDotsGrid(points, showPm25, showPm10);
  renderWeatherImpact();
}

const WEATHER_LABELS: { [key: string]: string } = {
  rain: 'Rain',
  snow: 'Snow',
  fog: 'Fog',
  cloudy: 'Cloudy',
  clear: 'Clear',
};

function computeWeatherGroups(): { [key: string]: { sum: number; count: number } } | null {
  if (!currentWeatherData || !currentHistoryData || !currentHistoryData.data) {
    return null;
  }

  const groups: { [key: string]: { sum: number; count: number } } = {};
  for (const p of currentHistoryData.data) {
    if (p.pm2_5 === null || p.pm2_5 === undefined) {
      continue;
    }
    let condition = conditionForTs(p.ts);
    if (condition === null) {
      continue;
    }
    if (condition === 'thunderstorm') {
      condition = 'rain';
    }
    if (!groups[condition]) {
      groups[condition] = { sum: 0, count: 0 };
    }
    groups[condition].sum += p.pm2_5;
    groups[condition].count += 1;
  }
  return groups;
}

function updateWeatherChips(groups: { [key: string]: { sum: number; count: number } } | null) {
  let activeVisible = currentWeatherFilter === 'all';

  for (const condition of Object.keys(WEATHER_LABELS)) {
    const btn = document.getElementById(`wf-${condition}`);
    if (!btn) {
      continue;
    }
    const present =
      groups !== null && groups[condition] !== undefined && groups[condition].count > 0;
    btn.style.display = present ? '' : 'none';
    if (present && currentWeatherFilter === condition) {
      activeVisible = true;
    }
  }

  if (!activeVisible) {
    setWeatherFilter('all');
  }
}

function renderWeatherImpact() {
  const container = document.getElementById('weather-impact');
  if (!container) {
    return;
  }

  const groups = computeWeatherGroups();
  updateWeatherChips(groups);

  if (!groups) {
    container.innerHTML = '';
    return;
  }

  let totalSum = 0;
  let totalCount = 0;
  for (const condition of Object.keys(groups)) {
    totalSum += groups[condition].sum;
    totalCount += groups[condition].count;
  }
  if (totalCount === 0) {
    container.innerHTML = '';
    return;
  }
  const overallAvg = totalSum / totalCount;
  const interval = currentWeatherData ? currentWeatherData.interval : 3600;

  const cards = Object.keys(WEATHER_LABELS)
    .filter((c) => groups[c] && groups[c].count >= 3)
    .map((c) => {
      const avg = groups[c].sum / groups[c].count;
      const hours = Math.round((groups[c].count * interval) / 3600);
      const diffPct = Math.round(((avg - overallAvg) / overallAvg) * 100);
      const diffColor = diffPct <= 0 ? 'var(--aqi-good)' : 'var(--aqi-poor)';
      const diffText =
        diffPct === 0 ? 'same as average' : `${diffPct > 0 ? '+' : ''}${diffPct}% vs average`;
      return `
        <div class="stat-card">
          <div class="stat-label" style="font-size: 11px; color: var(--on-surface-variant);">${WEATHER_LABELS[c]} (${hours}h of data)</div>
          <div class="stat-value" style="font-size: 18px; font-weight: bold; margin-top: 4px;">${avg.toFixed(1)} µg/m³</div>
          <div style="font-size: 11px; color: ${diffColor}; margin-top: 2px;">${diffText}</div>
        </div>
      `;
    });

  if (cards.length < 2) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div style="padding: 16px; background: var(--surface-variant); border-radius: 12px;">
      <div style="font-size: 12px; color: var(--on-surface-variant); margin-bottom: 12px; text-align: center;">Average PM2.5 by weather condition</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; text-align: center;">
        ${cards.join('')}
      </div>
    </div>
  `;
}

function setHistoryRange(range: string) {
  document
    .querySelectorAll('#view-history .btn-outlined')
    .forEach((btn) => btn.classList.remove('active'));
  const btn = document.getElementById(`hist-${range}`);
  if (btn) btn.classList.add('active');

  const customInputs = document.getElementById('hist-custom-inputs');
  if (customInputs) customInputs.style.display = 'none';

  currentHistoryRange = range;
  loadCustomHistory();
}

function toggleCustomRange() {
  document
    .querySelectorAll('#view-history .btn-outlined')
    .forEach((btn) => btn.classList.remove('active'));
  const btn = document.getElementById('hist-custom-btn');
  if (btn) btn.classList.add('active');

  const customInputs = document.getElementById('hist-custom-inputs');
  if (customInputs) customInputs.style.display = 'flex';
}

function applyCustomHistory() {
  const rangeInput = document.getElementById('custom-range') as HTMLInputElement;
  if (rangeInput && rangeInput.value) {
    currentHistoryRange = rangeInput.value;
    loadCustomHistory();
  }
}

async function loadCustomHistory() {
  if (!currentHistoryZoneId) return;

  const sensorSelect = document.getElementById('hist-sensor-select') as HTMLSelectElement;
  const location = sensorSelect
    ? sensorSelect.value === 'zone'
      ? currentHistoryZoneId
      : `${currentHistoryZoneId}_${sensorSelect.value}`
    : currentHistoryZoneId;

  const customInputs = document.getElementById('hist-custom-inputs');
  let interval = '1h';
  if (customInputs && customInputs.style.display === 'flex') {
    const intInput = document.getElementById('custom-interval') as HTMLInputElement;
    if (intInput && intInput.value) interval = intInput.value;
  } else {
    if (currentHistoryRange === '1w') interval = '1h';
    else if (currentHistoryRange === '1mo') interval = '4h';
    else if (currentHistoryRange === '6mo') interval = '1d';
  }

  const pm25Cb = document.getElementById('hist-pm25') as HTMLInputElement;
  const pm10Cb = document.getElementById('hist-pm10') as HTMLInputElement;

  const showPm25 = pm25Cb ? pm25Cb.checked : true;
  const showPm10 = pm10Cb ? pm10Cb.checked : true;

  let metrics = [];
  if (showPm25) metrics.push('pm2.5');
  if (showPm10) metrics.push('pm10');
  if (metrics.length === 0) metrics = ['pm2.5', 'pm10'];

  const [data, weather] = await Promise.all([
    fetchHistoricalData(location, currentHistoryRange, interval, metrics.join(',')),
    currentHistoryZoneId
      ? fetchWeatherHistory(currentHistoryZoneId, currentHistoryRange, interval)
      : Promise.resolve(null),
  ]);
  currentHistoryData = data;
  currentWeatherData = weather;

  renderFilteredHistory();
  setupExtendedPager();
  updateHistoryStatsUI();
}

function updateHistoryStatsUI() {
  if (!currentHistoryData || !currentHistoryData.stats) return;
  const stats = currentHistoryData.stats;

  const maxPm25El = document.getElementById('stat-max-pm25');
  const minPm25El = document.getElementById('stat-min-pm25');
  const avgPm25El = document.getElementById('stat-avg-pm25');

  const maxPm10El = document.getElementById('stat-max-pm10');
  const minPm10El = document.getElementById('stat-min-pm10');
  const avgPm10El = document.getElementById('stat-avg-pm10');

  if (maxPm25El) maxPm25El.innerText = stats.max_pm2_5 !== null ? stats.max_pm2_5 : '--';
  if (minPm25El) minPm25El.innerText = stats.min_pm2_5 !== null ? stats.min_pm2_5 : '--';
  if (avgPm25El) avgPm25El.innerText = stats.avg_pm2_5 !== null ? stats.avg_pm2_5 : '--';

  if (maxPm10El) maxPm10El.innerText = stats.max_pm10 !== null ? stats.max_pm10 : '--';
  if (minPm10El) minPm10El.innerText = stats.min_pm10 !== null ? stats.min_pm10 : '--';
  if (avgPm10El) avgPm10El.innerText = stats.avg_pm10 !== null ? stats.avg_pm10 : '--';
}

function downloadHistoryCSV() {
  if (!currentHistoryZoneId) return;
  const sensorSelect = document.getElementById('hist-sensor-select') as HTMLSelectElement;
  const location = sensorSelect
    ? sensorSelect.value === 'zone'
      ? currentHistoryZoneId
      : `${currentHistoryZoneId}_${sensorSelect.value}`
    : currentHistoryZoneId;

  const customInputs = document.getElementById('hist-custom-inputs');
  let interval = '1h';
  if (customInputs && customInputs.style.display === 'flex') {
    const intInput = document.getElementById('custom-interval') as HTMLInputElement;
    if (intInput && intInput.value) interval = intInput.value;
  } else {
    if (currentHistoryRange === '1w') interval = '1h';
    else if (currentHistoryRange === '1mo') interval = '4h';
    else if (currentHistoryRange === '6mo') interval = '1d';
  }

  window.open(
    `${API_URL}/historical-data/${location}/${currentHistoryRange}/${interval}/pm2.5,pm10?format=csv`
  );
}

// navigation logic

(window as any).showView = handleShowView;
(window as any).openDetails = openDetails;
(window as any).openNodeDetails = openNodeDetails;
(window as any).openHistoryView = openHistoryView;
(window as any).setHistoryRange = setHistoryRange;
(window as any).setWeatherFilter = setWeatherFilter;
(window as any).toggleCustomRange = toggleCustomRange;
(window as any).applyCustomHistory = applyCustomHistory;
(window as any).loadCustomHistory = loadCustomHistory;
(window as any).updateHistoryStatsUI = updateHistoryStatsUI;
(window as any).downloadHistoryCSV = downloadHistoryCSV;
(window as any).openModal = (id: string) => document.getElementById(id)?.classList.remove('hidden');
(window as any).closeModal = (id: string) => document.getElementById(id)?.classList.add('hidden');

function handleShowView(viewName: string) {
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active-view'));
  const view = document.getElementById(`view-${viewName}`);
  if (view) view.classList.add('active-view');

  updateNavHighlight(viewName);

  if (viewName === 'map') {
    initMap(allZones);
    resizeMap();
  }
  if (viewName === 'explore') {
    const searchInput = document.getElementById('zone-search') as HTMLInputElement;
    refreshExploreList(searchInput ? searchInput.value : '');
  }
}

function updateNavHighlight(viewName: string) {
  document.querySelectorAll('.nav-item, .nav-btn').forEach((el) => el.classList.remove('active'));

  let target = viewName;
  if (viewName === 'details' || viewName === 'history') target = 'dashboard';

  const mobBtn = document.getElementById(`nav-${target}`);
  if (mobBtn) mobBtn.classList.add('active');

  const sideBtn = document.getElementById(`side-${target}`);
  if (sideBtn) sideBtn.classList.add('active');
}

(window as any).toggleMapSheetPin = () => {
  const zoneId = getCurrentMapZoneId();
  if (zoneId) {
    togglePin(zoneId);

    // update button UI
    const pinBtn = document.getElementById('map-sheet-pin-btn');
    const pinIcon = document.getElementById('map-sheet-pin-icon');
    const pinText = document.getElementById('map-sheet-pin-text');

    if (pinBtn && pinIcon && pinText) {
      const isPinned = pinnedZoneIds.includes(zoneId);
      pinIcon.innerHTML = getPinIcon(isPinned);

      const svg = pinIcon.querySelector('svg');
      if (svg) {
        svg.style.width = '16px';
        svg.style.height = '16px';
      }

      if (isPinned) {
        pinBtn.classList.add('pinned');
        pinText.textContent = 'Pinned';
        pinBtn.style.color = 'var(--primary)';
        pinBtn.style.borderColor = 'var(--primary)';
      } else {
        pinBtn.classList.remove('pinned');
        pinText.textContent = 'Pin to Home';
        pinBtn.style.color = 'var(--on-surface-variant)';
        pinBtn.style.borderColor = 'var(--outline)';
      }

      pinBtn.classList.remove('pin-flash');
      void pinBtn.offsetWidth;
      pinBtn.classList.add('pin-flash');
    }
  }
};
