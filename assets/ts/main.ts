import { STORAGE_KEY_PINS } from './config.js';
import { fetchZones, getZoneAQI } from './api.js';
import { initTheme, initStandard } from './utils.js';
import { initMap, updateMapTiles, resizeMap } from './map.js';
import {
  renderDashboardCard,
  renderExploreItem,
  updateDetailView,
  updateChartTheme,
  renderSkeletonCard,
} from './ui.js';
import { Zone, AQIData } from './types.js';

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
       const zone = allZones.find(z => z.name === title);
       if(zone) openDetails(zone.id);
    }
    
    // If in map view, refresh markers
    if (document.getElementById('view-map')?.classList.contains('active-view')) {
        initMap(allZones); 
    }
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

  // Show skeleton loaders immediately
  const skeletons = Array.from({ length: 4 }, () => renderSkeletonCard());
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
    .map((result) =>
      renderDashboardCard(result.zone, result.data, () => openDetails(result.zone.id))
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