import { STORAGE_KEY_PINS } from './config.js';
import { fetchZones, getZoneAQI, getZonesAQI } from './api.js';
import {
  initTheme,
  initStandard,
  initKeyboardActivation,
  initSheetDragging,
  showSnackbar,
  getAQIStandard,
  getAQIColor,
  aqiTextColor,
} from './utils.js';
import { initMotion, motionEnabled } from './motion.js';
import { initMapOptions } from './mapoptions.js';
import { initMap, updateMapTiles, resizeMap, openMapZoneById, stopMapPlayback } from './map.js';
import { getPanelZoneId, setPanelPinned, closeZonePanel, refreshZonePanel } from './panel.js';
import {
  renderDashboardCard,
  updateDetailView,
  updateChartTheme,
  renderSkeletonCard,
} from './ui.js';
import {
  initExplore,
  renderExplore,
  setExploreData,
  repaintExplore,
  revealDistrict,
  syncExplorePin,
} from './explore.js';
import {
  initHistory,
  openHistoryFor,
  refreshHistory,
  historyZoneId,
  syncHistoryRawMode,
} from './history.js';
import {
  hideRawHint,
  initRawMode,
  isEstimate,
  isRawMode,
  setRawMode,
  zoneAqi,
} from './readings.js';
import { Zone, AQIData } from './types.js';

let allZones: Zone[] = [];
let dashboardHasRendered = false;
let pinnedZoneIds: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY_PINS) || '[]');
let isReordering = false;

// init
document.addEventListener('DOMContentLoaded', async () => {
  initMotion();
  initMapOptions(() => stopMapPlayback());
  initKeyboardActivation();
  initSheetDragging();

  initTheme((newTheme) => {
    updateMapTiles(newTheme);
    updateChartTheme();
    repaintAqiColours();
  });

  initStandard(() => {
    repaintAqiColours();
  });

  initRawMode(() => {
    syncRawUrl();
    repaintAqiColours();
    syncHistoryRawMode();
  });

  initExplore({
    isPinned: (id) => pinnedZoneIds.includes(id),
    togglePin: (id) => togglePin(id),
    openPlace: (id) => openDetails(id),
  });
  initHistory(handleShowView, () => allZones);

  allZones = await fetchZones();
  migratePins();
  refreshDashboard();

  updateNavHighlight('dashboard');

  history.replaceState({ depth: 0 }, '', location.pathname);
  applyRoute(parseRoute(location.pathname));
  window.addEventListener('popstate', () => {
    applyRoute(parseRoute(location.pathname));
  });
  window.addEventListener('zonepanel', () => {
    if (applyingRoute || !document.getElementById('view-map')?.classList.contains('active-view')) {
      return;
    }
    const path = routePath('map');
    if (path !== location.pathname) {
      history.replaceState(history.state, '', path);
    }
    document.title = getPanelZoneId()
      ? `${allZones.find((z) => z.id === getPanelZoneId())?.name ?? 'Zone'} on the map | Breathe`
      : routeTitle('map');
  });

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

  watchDetailScroll();
});

function migratePins() {
  if (allZones.length === 0) {
    return;
  }
  const known = new Set(allZones.map((z) => z.id));
  const next: string[] = [];
  const add = (id: string) => {
    if (!next.includes(id)) {
      next.push(id);
    }
  };
  pinnedZoneIds.forEach((id) => {
    if (known.has(id)) {
      add(id);
      return;
    }
    const replacements = allZones.filter((z) => z.legacy_zone === id);
    if (replacements.length === 0) {
      add(id);
      return;
    }
    replacements.forEach((z) => add(z.id));
  });
  if (next.join(',') !== pinnedZoneIds.join(',')) {
    pinnedZoneIds = next;
    localStorage.setItem(STORAGE_KEY_PINS, JSON.stringify(pinnedZoneIds));
  }
}

function repaintAqiColours() {
  refreshDashboard();
  repaintExplore();
  refreshHistory();

  const detailView = document.getElementById('view-details');
  if (detailView && detailView.classList.contains('active-view') && currentZoneId) {
    openDetails(currentZoneId);
  }

  if (document.getElementById('view-map')?.classList.contains('active-view')) {
    initMap(allZones);
    refreshZonePanel();
  }
}

// Reveals the reading in the title bar once the main card has scrolled away.
// The two thresholds are deliberately apart so resting on the boundary does
// not flicker the header.
function watchDetailScroll() {
  const view = document.getElementById('view-details');
  const scroller = view ? view.querySelector('.content-scroll') : null;
  if (!view || !scroller) return;

  scroller.addEventListener('scroll', () => {
    const scrolled = view.classList.contains('scrolled');
    if (!scrolled && scroller.scrollTop > 96) {
      view.classList.add('scrolled');
    } else if (scrolled && scroller.scrollTop < 64) {
      view.classList.remove('scrolled');
    }
  });
}

// controller actions

async function refreshDashboard() {
  const container = document.getElementById('pinned-container');
  const emptyState = document.getElementById('empty-state');
  if (!container || !emptyState) return;

  container.innerHTML = '';

  if (pinnedZoneIds.length < 2) {
    isReordering = false;
  }
  updateReorderButton();

  document
    .getElementById('view-dashboard')
    ?.classList.toggle('is-empty', pinnedZoneIds.length === 0);

  if (pinnedZoneIds.length === 0) {
    emptyState.classList.remove('hidden');
    requestAnimationFrame(drawEmptyHints);
    renderRightNow();
    return;
  }
  emptyState.classList.add('hidden');

  // Show skeleton loaders immediately
  const skeletons = Array.from({ length: Math.min(pinnedZoneIds.length, 4) }, () =>
    renderSkeletonCard()
  );
  container.append(...skeletons);

  const aqiById = await getZonesAQI(
    pinnedZoneIds.filter((id) => allZones.some((z) => z.id === id))
  );
  const results = pinnedZoneIds.map((id) => {
    const zone = allZones.find((z) => z.id === id);
    const data = aqiById[id];
    if (!zone || !data) return null;
    return { zone, data };
  });

  // Create all cards in memory first (no DOM operations yet)
  const cards = results
    .filter((result): result is { zone: Zone; data: AQIData } => result !== null)
    .map((result, index) => {
      const card = renderDashboardCard(
        result.zone,
        result.data,
        () => {
          if (!isReordering) {
            openDetails(result.zone.id);
          }
        },
        index,
        !dashboardHasRendered
      );
      card.dataset.zoneId = result.zone.id;
      return card;
    });
  dashboardHasRendered = true;

  // Replace all skeletons with actual cards in a single operation
  container.innerHTML = '';
  container.append(...cards);
  applyReorderMode();
}

// reordering

function updateReorderButton() {
  const btn = document.getElementById('reorder-btn');
  if (!btn) return;

  btn.classList.toggle('hidden', pinnedZoneIds.length < 2);
  btn.classList.toggle('active', isReordering);
  btn.textContent = isReordering ? 'Done' : 'Reorder';
}

function toggleReorder() {
  isReordering = !isReordering;
  updateReorderButton();
  applyReorderMode();
}

function applyReorderMode() {
  const container = document.getElementById('pinned-container');
  if (!container) return;

  container.classList.toggle('reordering', isReordering);
  Array.from(container.children).forEach((el) => {
    const card = el as HTMLElement;
    card.querySelector('.reorder-controls')?.remove();
    if (isReordering && card.dataset.zoneId) {
      card.append(renderReorderControls(card, container));
    }
  });
}

function savePinOrderFromDom(container: HTMLElement) {
  const domOrder = Array.from(container.children)
    .map((el) => (el as HTMLElement).dataset.zoneId)
    .filter((id): id is string => !!id);
  const rest = pinnedZoneIds.filter((id) => !domOrder.includes(id));

  pinnedZoneIds = [...domOrder, ...rest];
  localStorage.setItem(STORAGE_KEY_PINS, JSON.stringify(pinnedZoneIds));
}

const flipAnimations = new WeakMap<HTMLElement, Animation>();

// Slides the other cards from where they were to where they are now, so a
// reorder reads as movement instead of a jump.
function moveCardWithFlip(container: HTMLElement, move: () => void, skip?: HTMLElement) {
  const siblings = Array.from(container.children) as HTMLElement[];
  const before = new Map(siblings.map((el) => [el, el.getBoundingClientRect()]));

  siblings.forEach((el) => {
    flipAnimations.get(el)?.cancel();
  });

  move();

  const listMotionOff = (document.documentElement.getAttribute('data-motion-off') || '')
    .split(' ')
    .includes('listAnimations');
  if (listMotionOff) return;

  siblings.forEach((el) => {
    if (el === skip) return;
    const from = before.get(el);
    if (!from) return;
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (dx === 0 && dy === 0) return;

    const animation = el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      {
        duration: 320,
        easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
      }
    );
    flipAnimations.set(el, animation);

    const clear = () => {
      if (flipAnimations.get(el) === animation) {
        flipAnimations.delete(el);
      }
    };
    animation.onfinish = clear;
    animation.oncancel = clear;
  });
}

function renderReorderControls(card: HTMLElement, container: HTMLElement): HTMLElement {
  const controls = document.createElement('div');
  controls.className = 'reorder-controls';
  controls.onclick = (e) => e.stopPropagation();
  controls.innerHTML = `
        <button class="reorder-arrow" aria-label="Move earlier">
            <svg viewBox="0 0 24 24"><path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z" /></svg>
        </button>
        <button class="reorder-arrow" aria-label="Move later">
            <svg viewBox="0 0 24 24"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>
        </button>
        <span class="reorder-handle" aria-label="Drag to reorder">
            <svg viewBox="0 0 24 24"><path d="M20 9H4v2h16V9zM4 15h16v-2H4v2z" /></svg>
        </span>
    `;

  const [earlier, later] = Array.from(controls.querySelectorAll('button'));
  earlier.onclick = () => {
    const prev = card.previousElementSibling;
    if (!prev) return;
    moveCardWithFlip(container, () => prev.before(card));
    savePinOrderFromDom(container);
  };
  later.onclick = () => {
    const next = card.nextElementSibling;
    if (!next) return;
    moveCardWithFlip(container, () => next.after(card));
    savePinOrderFromDom(container);
  };

  const handle = controls.querySelector('.reorder-handle') as HTMLElement;
  handle.addEventListener('pointerdown', (e) => startCardDrag(card, container, e));

  return controls;
}

function startCardDrag(card: HTMLElement, container: HTMLElement, e: PointerEvent) {
  e.preventDefault();
  card.classList.add('dragging');

  const startRect = card.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  let tx = 0;
  let ty = 0;
  const columns = getComputedStyle(container).gridTemplateColumns.split(' ').length;
  const isHorizontal = columns > 1;

  const onMove = (ev: PointerEvent) => {
    const current = card.getBoundingClientRect();
    const probeX = isHorizontal ? ev.clientX : current.left - tx + current.width / 2;
    const probeY = isHorizontal ? current.top - ty + current.height / 2 : ev.clientY;
    const over = document
      .elementsFromPoint(probeX, probeY)
      .map((el) => (el as HTMLElement).closest('.dashboard-card') as HTMLElement | null)
      .find(
        (el) =>
          el !== null && el !== card && el.parentElement === container && !flipAnimations.has(el)
      );

    if (over) {
      const children = Array.from(container.children);
      const movingLater = children.indexOf(over) > children.indexOf(card);
      moveCardWithFlip(
        container,
        () => {
          if (movingLater) {
            over.after(card);
          } else {
            over.before(card);
          }
        },
        card
      );
    }

    const rect = card.getBoundingClientRect();
    const layoutLeft = rect.left - tx;
    const layoutTop = rect.top - ty;
    if (isHorizontal) {
      tx = startRect.left + (ev.clientX - startX) - layoutLeft;
      ty = 0;
    } else {
      tx = 0;
      ty = startRect.top + (ev.clientY - startY) - layoutTop;
    }
    card.style.transform = `translate(${tx}px, ${ty}px)`;
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    card.classList.remove('dragging');
    card.style.transform = '';
    savePinOrderFromDom(container);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function displayAqiFor(data: AQIData | null | undefined): number | null {
  if (!data) {
    return null;
  }
  return zoneAqi(data);
}

async function renderRightNow() {
  const box = document.getElementById('right-now');
  const worstEl = document.getElementById('right-now-worst');
  const bestEl = document.getElementById('right-now-best');
  if (!box || !worstEl || !bestEl || allZones.length === 0) {
    return;
  }

  const byId = await getZonesAQI(allZones.map((z) => z.id));
  const std = getAQIStandard();
  const ranked = allZones
    .map((zone) => ({ zone, aqi: displayAqiFor(byId[zone.id]) }))
    .filter((entry): entry is { zone: Zone; aqi: number } => entry.aqi !== null)
    .sort((a, b) => b.aqi - a.aqi);
  if (ranked.length < 2) {
    box.classList.add('hidden');
    return;
  }

  const row = (entry: { zone: Zone; aqi: number }) => {
    const button = document.createElement('button');
    button.className = 'right-now-row';
    button.innerHTML = `
      <span>${entry.zone.name}</span>
      <span class="right-now-aqi" style="background: ${getAQIColor(entry.aqi, std).hex}; color: ${aqiTextColor(entry.aqi, std)};">${entry.aqi}</span>
    `;
    button.onclick = () => openDetails(entry.zone.id);
    return button;
  };

  const count = Math.min(3, Math.floor(ranked.length / 2));
  worstEl.replaceChildren(...ranked.slice(0, count).map(row));
  bestEl.replaceChildren(...ranked.slice(-count).reverse().map(row));
  box.classList.remove('hidden');
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestZone(lat: number, lon: number): { zone: Zone; km: number } | null {
  let best: { zone: Zone; km: number } | null = null;
  allZones.forEach((zone) => {
    if (!zone.lat || !zone.lon) {
      return;
    }
    const km = distanceKm(lat, lon, zone.lat, zone.lon);
    if (!best || km < best.km) {
      best = { zone, km };
    }
  });
  return best;
}

function openNearestZone() {
  if (!navigator.geolocation) {
    showSnackbar("This browser can't share its location");
    return;
  }
  const button = document.getElementById('nearest-btn') as HTMLButtonElement | null;
  if (button) {
    button.disabled = true;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (button) {
        button.disabled = false;
      }
      const found = nearestZone(position.coords.latitude, position.coords.longitude);
      if (!found) {
        return;
      }
      openDetails(found.zone.id);
      if (found.km > 60) {
        showSnackbar(`${found.zone.name} is the closest zone, ${Math.round(found.km)} km away`);
      }
    },
    () => {
      if (button) {
        button.disabled = false;
      }
      showSnackbar("Couldn't get your location");
    },
    { maximumAge: 600000, timeout: 10000 }
  );
}

(window as any).openNearestZone = openNearestZone;

// empty dashboard hints

function handDrawnArrow(
  fromX: number,
  fromY: number,
  controlX: number,
  controlY: number,
  toX: number,
  toY: number
) {
  const angle = Math.atan2(toY - controlY, toX - controlX);
  const head = 12;
  const spread = 0.5;
  const leftX = toX - head * Math.cos(angle - spread);
  const leftY = toY - head * Math.sin(angle - spread);
  const rightX = toX - head * Math.cos(angle + spread);
  const rightY = toY - head * Math.sin(angle + spread);

  return `
        <path d="M ${fromX} ${fromY} Q ${controlX} ${controlY} ${toX} ${toY}" />
        <path d="M ${leftX} ${leftY} L ${toX} ${toY} L ${rightX} ${rightY}" />
    `;
}

function drawEmptyHints() {
  const state = document.getElementById('empty-state');
  const svg = document.getElementById('empty-hints');
  const exploreNote = state?.querySelector('.hint-explore') as HTMLElement | null;
  const addNote = state?.querySelector('.hint-add') as HTMLElement | null;
  const exploreTarget = document.getElementById('side-explore');
  const addTarget = document.querySelector('#view-dashboard .add-btn');
  if (!state || !svg || !exploreNote || !addNote || !exploreTarget || !addTarget) return;

  svg.innerHTML = '';
  if (state.classList.contains('hidden') || window.innerWidth < 768) return;

  const base = state.getBoundingClientRect();
  if (base.width === 0) return;

  const explore = exploreTarget.getBoundingClientRect();
  const exploreY = explore.top + explore.height / 2 - base.top;
  exploreNote.style.left = '72px';
  exploreNote.style.top = `${exploreY + 48}px`;

  const add = addTarget.getBoundingClientRect();
  const addX = add.left + add.width / 2 - base.left;
  const addY = add.bottom - base.top;
  addNote.style.left = 'auto';
  addNote.style.right = `${base.right - add.left + 24}px`;
  addNote.style.top = `${addY + 72}px`;

  svg.innerHTML =
    handDrawnArrow(66, exploreY + 60, 52, exploreY + 2, 14, exploreY) +
    handDrawnArrow(addX - 40, addY + 84, addX, addY + 70, addX, addY + 10);

  svg.querySelectorAll('path').forEach((path) => {
    const length = (path as SVGPathElement).getTotalLength();
    path.style.setProperty('--path-length', `${length}`);
  });
}

let exploreAqiLoading = false;

async function loadExploreAqi() {
  if (exploreAqiLoading) {
    return;
  }
  exploreAqiLoading = true;
  const byId = await getZonesAQI(allZones.map((z) => z.id));
  exploreAqiLoading = false;
  setExploreData(byId);
}

function refreshExploreList(filter: string = '') {
  renderExplore(allZones, filter);
}

function togglePin(id: string, announce: boolean = true) {
  const wasPinned = pinnedZoneIds.includes(id);

  if (wasPinned) {
    pinnedZoneIds = pinnedZoneIds.filter((zid) => zid !== id);
  } else {
    pinnedZoneIds.push(id);
  }
  localStorage.setItem(STORAGE_KEY_PINS, JSON.stringify(pinnedZoneIds));
  syncExplorePin(id);
  if (getPanelZoneId() === id) {
    setPanelPinned(pinnedZoneIds.includes(id));
  }
  refreshDashboard();

  if (!announce) return;

  const zone = allZones.find((z) => z.id === id);
  const name = zone ? zone.name : 'place';
  showSnackbar(`${wasPinned ? 'Unpinned' : 'Pinned'} ${name}`, 'Undo', () => {
    togglePin(id, false);
  });
}

let currentZoneId: string | null = null;

let lastDetailZoneId: string | null = null;

function resetDetailReadings() {
  ['detail-aqi', 'detail-header-aqi'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.innerText = '0';
    }
  });
  const indicator = document.getElementById('aqi-bar-indicator');
  if (indicator) {
    indicator.style.left = '0%';
    void indicator.offsetWidth;
  }
}

async function openDetails(zoneId: string) {
  currentZoneId = zoneId;
  if (lastDetailZoneId !== zoneId) {
    resetDetailReadings();
    lastDetailZoneId = zoneId;
  }
  handleShowView('details');
  const zone = allZones.find((z) => z.id === zoneId);
  if (!zone) return;

  const data = await getZoneAQI(zoneId);
  if (data) {
    updateDetailView(zone, data);
  }
}

function openHistoryView() {
  const zone = allZones.find((z) => z.id === currentZoneId);
  if (!zone) return;
  openHistoryFor(zone);
}

function openDistrictInExplore(district: string) {
  handleShowView('explore');
  revealDistrict(district);
}

// navigation logic

(window as any).showView = handleShowView;
(window as any).toggleReorder = toggleReorder;
window.addEventListener('resize', drawEmptyHints);
(window as any).openDetails = openDetails;
(window as any).openHistoryView = openHistoryView;
(window as any).openDistrictInExplore = openDistrictInExplore;
(window as any).setRawMode = (on: boolean) => setRawMode(on);
(window as any).hideRawHint = hideRawHint;
(window as any).openModal = (id: string) => document.getElementById(id)?.classList.remove('hidden');
(window as any).closeModal = (id: string) => document.getElementById(id)?.classList.add('hidden');

const VIEW_DEPTH: { [name: string]: number } = {
  dashboard: 0,
  map: 0,
  explore: 0,
  settings: 0,
  details: 1,
  history: 2,
};

let currentViewDepth = 0;

function handleShowView(viewName: string) {
  document.querySelectorAll('.view').forEach((el) => {
    el.classList.remove('active-view', 'enter-forward', 'enter-back');
  });

  const nextDepth = VIEW_DEPTH[viewName] ?? 0;
  const view = document.getElementById(`view-${viewName}`);
  if (view) {
    if (nextDepth > currentViewDepth) {
      view.classList.add('enter-forward');
    } else if (nextDepth < currentViewDepth) {
      view.classList.add('enter-back');
    }
    view.classList.add('active-view');
  }
  currentViewDepth = nextDepth;

  updateNavHighlight(viewName);
  syncUrl(viewName);

  if (viewName === 'dashboard') {
    requestAnimationFrame(drawEmptyHints);
  }

  if (viewName === 'map') {
    initMap(allZones);
    resizeMap();
  } else {
    closeZonePanel(false);
  }
  if (viewName === 'explore') {
    const searchInput = document.getElementById('zone-search') as HTMLInputElement;
    refreshExploreList(searchInput ? searchInput.value : '');
    loadExploreAqi();
  }
}

interface Route {
  view: string;
  zoneId: string | null;
}

const DEFAULT_TITLE = document.title;

function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter((part) => part.length > 0);
  if (parts[0] === 'zone' && parts[1]) {
    const zoneId = decodeURIComponent(parts[1]);
    if (parts[2] === 'history') {
      return { view: 'history', zoneId };
    }
    return { view: 'details', zoneId };
  }
  if (parts[0] === 'map') {
    return { view: 'map', zoneId: parts[1] ? decodeURIComponent(parts[1]) : null };
  }
  if (parts[0] === 'explore' || parts[0] === 'settings') {
    return { view: parts[0], zoneId: null };
  }
  return { view: 'dashboard', zoneId: null };
}

const RAW_SUFFIX = '-raw';

function zoneSlug(id: string, raw: boolean = isRawMode()): string {
  const zone = allZones.find((z) => z.id === id);
  const suffix = raw && zone && !isEstimate(zone) ? RAW_SUFFIX : '';
  return encodeURIComponent(id + suffix);
}

function routePath(viewName: string, raw: boolean = isRawMode()): string {
  if (viewName === 'map' && getPanelZoneId()) {
    return `/map/${encodeURIComponent(getPanelZoneId()!)}`;
  }
  if (viewName === 'details' && currentZoneId) {
    return `/zone/${zoneSlug(currentZoneId, raw)}`;
  }
  if (viewName === 'history' && historyZoneId()) {
    return `/zone/${zoneSlug(historyZoneId()!, raw)}/history`;
  }
  if (viewName === 'map' || viewName === 'explore' || viewName === 'settings') {
    return `/${viewName}`;
  }
  return '/';
}

function activeViewName(): string | null {
  const view = document.querySelector('.view.active-view');
  return view ? view.id.replace('view-', '') : null;
}

function syncRawUrl() {
  const view = activeViewName();
  if (view !== 'details' && view !== 'history') {
    return;
  }
  const path = routePath(view);
  if (path !== location.pathname) {
    history.replaceState(history.state, '', path);
  }
}

function routeTitle(viewName: string): string {
  const zoneName = (id: string | null) => allZones.find((z) => z.id === id)?.name;
  if (viewName === 'details') {
    const name = zoneName(currentZoneId);
    if (name) {
      return `${name} air quality right now | Breathe`;
    }
  }
  if (viewName === 'history') {
    const name = zoneName(historyZoneId());
    if (name) {
      return `${name} air quality history | Breathe`;
    }
  }
  if (viewName === 'map') {
    return 'Air quality map of Jammu & Kashmir and Ladakh | Breathe';
  }
  if (viewName === 'explore') {
    return 'Sensors by district | Breathe';
  }
  if (viewName === 'settings') {
    return 'Settings | Breathe';
  }
  return DEFAULT_TITLE;
}

let applyingRoute = false;

function syncUrl(viewName: string) {
  const path = routePath(viewName);
  document.title = routeTitle(viewName);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    canonical.setAttribute('href', `https://breatheoss.app${routePath(viewName, false)}`);
  }
  if (applyingRoute || path === location.pathname) {
    return;
  }
  const depth = history.state && typeof history.state.depth === 'number' ? history.state.depth : 0;
  history.pushState({ depth: depth + 1 }, '', path);
}

function legacyPlaces(id: string | null): Zone[] {
  if (id === null) {
    return [];
  }
  return allZones.filter((z) => z.legacy_zone === id);
}

function applyRoute(route: Route) {
  applyingRoute = true;
  try {
    if (route.zoneId !== null && route.zoneId.endsWith(RAW_SUFFIX)) {
      const base = route.zoneId.slice(0, -RAW_SUFFIX.length);
      const zone = allZones.find((z) => z.id === base);
      if (zone && !isEstimate(zone)) {
        route = { ...route, zoneId: base };
        if (!isRawMode()) {
          setRawMode(true);
        }
      }
    }
    const legacy = legacyPlaces(route.zoneId);
    if (
      route.zoneId !== null &&
      !allZones.some((z) => z.id === route.zoneId) &&
      legacy.length > 0
    ) {
      if (legacy.length === 1) {
        route = { ...route, zoneId: legacy[0].id };
        const suffix = route.view === 'history' ? '/history' : '';
        const base = route.view === 'map' ? '/map/' : '/zone/';
        history.replaceState(
          history.state,
          '',
          `${base}${encodeURIComponent(legacy[0].id)}${suffix}`
        );
      } else if (route.view === 'details' || route.view === 'history') {
        handleShowView('explore');
        history.replaceState(history.state, '', '/explore');
        revealDistrict(legacy[0].district || '');
        return;
      } else if (route.view === 'map') {
        route = { ...route, zoneId: null };
      }
    }
    const known = route.zoneId !== null && allZones.some((z) => z.id === route.zoneId);
    if (route.view === 'details' && known) {
      openDetails(route.zoneId!);
    } else if (route.view === 'history' && known) {
      currentZoneId = route.zoneId;
      openHistoryView();
    } else if (route.view === 'details' || route.view === 'history') {
      handleShowView('dashboard');
      history.replaceState(history.state, '', '/');
    } else if (route.view === 'map') {
      if (!document.getElementById('view-map')?.classList.contains('active-view')) {
        handleShowView('map');
      }
      if (route.zoneId && allZones.some((z) => z.id === route.zoneId)) {
        openMapZoneById(route.zoneId, allZones);
      } else {
        closeZonePanel(false);
      }
    } else {
      handleShowView(route.view);
    }
  } finally {
    applyingRoute = false;
  }
  syncRawUrl();
}

function goBack(fallback: string) {
  if (history.state && history.state.depth > 0) {
    history.back();
    return;
  }
  applyingRoute = true;
  try {
    if (fallback === 'details' && historyZoneId()) {
      openDetails(historyZoneId()!);
    } else {
      fallback = 'dashboard';
      handleShowView(fallback);
    }
  } finally {
    applyingRoute = false;
  }
  history.replaceState({ depth: 0 }, '', routePath(fallback));
}

(window as any).goBack = goBack;

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
  const zoneId = getPanelZoneId();
  if (zoneId) {
    togglePin(zoneId);
  }
};

// Register Service Worker for PWA support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        console.log('ServiceWorker registered with scope:', registration.scope);
      })
      .catch((error) => {
        console.error('ServiceWorker registration failed:', error);
      });
  });
}
