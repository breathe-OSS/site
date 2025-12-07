import { STORAGE_KEY_PINS } from './config.js';
import { fetchZones, getZoneAQI } from './api.js';
import { initTheme } from './utils.js';
import { initMap, updateMapTiles, resizeMap } from './map.js';
import {
  renderDashboardCard,
  renderExploreItem,
  updateDetailView,
  updateChartTheme,
} from './ui.js';
import { Zone } from './types.js';

let allZones: Zone[] = [];
let pinnedZoneIds: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY_PINS) || '[]');

// init
document.addEventListener('DOMContentLoaded', async () => {
  initTheme((newTheme) => {
    updateMapTiles(newTheme);
    updateChartTheme();
  });

  allZones = await fetchZones();
  refreshDashboard();

  updateNavHighlight('dashboard');

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

  for (const id of pinnedZoneIds) {
    const zone = allZones.find((z) => z.id === id);
    if (!zone) continue;
    const data = await getZoneAQI(id);
    if (!data) continue;

    const card = renderDashboardCard(zone, data, () => openDetails(zone.id));
    container.appendChild(card);
  }
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

async function openDetails(zoneId: string) {
  handleShowView('details');
  const zone = allZones.find((z) => z.id === zoneId);
  if (!zone) return;

  const data = await getZoneAQI(zoneId);
  if (data) {
    updateDetailView(zone, data);
  }
}

// navigation logic

(window as any).showView = handleShowView;
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
  if (viewName === 'details') target = 'dashboard';

  const mobBtn = document.getElementById(`nav-${target}`);
  if (mobBtn) mobBtn.classList.add('active');

  const sideBtn = document.getElementById(`side-${target}`);
  if (sideBtn) sideBtn.classList.add('active');
}
