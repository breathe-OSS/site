import { AQIData, Zone } from './types.js';
import {
  aqiTextColor,
  getAQICategory,
  getAQIColor,
  getAQIStandard,
  makeActivatable,
} from './utils.js';
import { isEstimate, zoneAqi } from './readings.js';
import { getPinIconStack, setPinIcon } from './ui.js';

const DIVISION_ORDER = ['Jammu', 'Kashmir', 'Ladakh'];
const STORAGE_KEY_OPEN = 'breathe_explore_open';

interface ExploreHandlers {
  isPinned: (id: string) => boolean;
  togglePin: (id: string) => void;
  openPlace: (id: string) => void;
}

interface DistrictGroup {
  key: string;
  district: string;
  division: string;
  places: Zone[];
}

let handlers: ExploreHandlers | null = null;
let builtFor: Zone[] | null = null;
let latestAqi: { [id: string]: AQIData | null } | null = null;
let currentFilter = '';

const groups: DistrictGroup[] = [];
const districtEls: { [key: string]: HTMLElement } = {};
const placeEls: { [id: string]: HTMLElement } = {};
let openDistricts = new Set<string>(readOpenDistricts());

function readOpenDistricts(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_OPEN) || '[]');
  } catch (e) {
    return [];
  }
}

function saveOpenDistricts() {
  try {
    localStorage.setItem(STORAGE_KEY_OPEN, JSON.stringify(Array.from(openDistricts)));
  } catch (e) {
    return;
  }
}

function districtKey(place: Zone): string {
  return `${place.division || 'Other'}/${place.district || place.name}`;
}

function groupPlaces(places: Zone[]) {
  groups.length = 0;
  const byKey: { [key: string]: DistrictGroup } = {};
  places.forEach((place) => {
    const key = districtKey(place);
    if (!byKey[key]) {
      byKey[key] = {
        key,
        district: place.district || place.name,
        division: place.division || 'Other',
        places: [],
      };
      groups.push(byKey[key]);
    }
    byKey[key].places.push(place);
  });
  groups.forEach((group) => {
    group.places.sort((a, b) => {
      if (isEstimate(a) !== isEstimate(b)) {
        return isEstimate(a) ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });
  });
  groups.sort((a, b) => a.district.localeCompare(b.district));
}

function districtSummary(group: DistrictGroup): string {
  const sensors = group.places.filter((p) => !isEstimate(p)).length;
  const estimates = group.places.length - sensors;
  if (group.places.length === 1) {
    const only = group.places[0];
    if (isEstimate(only)) {
      return only.name === group.district
        ? 'Satellite estimate'
        : `${only.name} · satellite estimate`;
    }
    return `${only.name} · 1 sensor`;
  }
  const parts: string[] = [];
  if (sensors > 0) {
    parts.push(`${sensors} sensor${sensors === 1 ? '' : 's'}`);
  }
  if (estimates > 0) {
    parts.push(`${estimates} satellite estimate${estimates === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

function chipHtml(): string {
  return '<div class="explore-aqi skeleton-line" aria-hidden="true"></div>';
}

function pinButton(place: Zone): HTMLButtonElement {
  const pinned = handlers ? handlers.isPinned(place.id) : false;
  const btn = document.createElement('button');
  btn.className = `pin-btn${pinned ? ' pinned' : ''}`;
  btn.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${place.name}`);
  btn.innerHTML = getPinIconStack(pinned);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers?.togglePin(place.id);
  });
  return btn;
}

function placeKindHtml(place: Zone): string {
  if (isEstimate(place)) {
    return 'Satellite estimate';
  }
  return '<span class="status-indicator"></span> Live sensor';
}

function buildPlaceRow(place: Zone): HTMLElement {
  const row = document.createElement('div');
  row.className = 'place-row';
  row.dataset.placeId = place.id;
  row.dataset.placeName = place.name;
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-label', `Open ${place.name}`);
  row.innerHTML = `
    <div class="place-text">
      <div class="place-name">${place.name}</div>
      <div class="place-kind">${placeKindHtml(place)}</div>
    </div>
    ${chipHtml()}
  `;
  row.appendChild(pinButton(place));
  row.addEventListener('click', () => handlers?.openPlace(place.id));
  makeActivatable(row);
  placeEls[place.id] = row;
  return row;
}

function setExpanded(group: DistrictGroup, expanded: boolean) {
  const card = districtEls[group.key];
  if (!card) return;
  card.classList.toggle('expanded', expanded);
  const head = card.querySelector('.district-head');
  head?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function buildDistrict(group: DistrictGroup, index: number): HTMLElement {
  const card = document.createElement('div');
  card.className = 'district-card';
  card.style.animationDelay = `calc(${Math.min(index, 7)} * var(--list-stagger))`;
  card.dataset.district = group.key;
  districtEls[group.key] = card;

  const single = group.places.length === 1;
  const head = document.createElement('div');
  head.className = 'district-head';
  head.setAttribute('role', 'button');
  head.setAttribute('tabindex', '0');
  head.innerHTML = `
    <div class="district-text">
      <div class="district-name">${group.district} district</div>
      <div class="district-sub">${single && !isEstimate(group.places[0]) ? '<span class="status-indicator"></span> ' : ''}${districtSummary(group)}</div>
    </div>
    ${chipHtml()}
  `;
  card.appendChild(head);

  if (single) {
    const place = group.places[0];
    head.dataset.placeId = place.id;
    head.dataset.placeName = place.name;
    head.setAttribute('aria-label', `Open ${place.name}`);
    head.appendChild(pinButton(place));
    head.addEventListener('click', () => handlers?.openPlace(place.id));
    placeEls[place.id] = head;
  } else {
    head.setAttribute('aria-expanded', 'false');
    head.setAttribute('aria-label', `${group.district} district, ${districtSummary(group)}`);
    head.insertAdjacentHTML(
      'beforeend',
      '<svg class="district-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>'
    );
    head.addEventListener('click', () => {
      const open = !card.classList.contains('expanded');
      if (open) {
        openDistricts.add(group.key);
      } else {
        openDistricts.delete(group.key);
      }
      saveOpenDistricts();
      setExpanded(group, open);
    });

    const body = document.createElement('div');
    body.className = 'district-body';
    const inner = document.createElement('div');
    inner.className = 'district-body-inner';
    group.places.forEach((place) => inner.appendChild(buildPlaceRow(place)));
    body.appendChild(inner);
    card.appendChild(body);
    setExpanded(group, openDistricts.has(group.key));
  }
  makeActivatable(head);
  return card;
}

function build(container: HTMLElement, places: Zone[]) {
  container.textContent = '';
  Object.keys(districtEls).forEach((k) => delete districtEls[k]);
  Object.keys(placeEls).forEach((k) => delete placeEls[k]);
  groupPlaces(places);

  const rank = (division: string) => {
    const index = DIVISION_ORDER.indexOf(division);
    return index === -1 ? DIVISION_ORDER.length : index;
  };
  const divisions = Array.from(new Set(groups.map((g) => g.division))).sort(
    (a, b) => rank(a) - rank(b)
  );

  let index = 0;
  divisions.forEach((division) => {
    const section = document.createElement('section');
    section.className = 'explore-division';
    section.dataset.division = division;
    section.innerHTML = `<h2 class="explore-division-title">${division}</h2>`;
    const grid = document.createElement('div');
    grid.className = 'explore-grid';
    section.appendChild(grid);
    groups
      .filter((g) => g.division === division)
      .forEach((group) => {
        grid.appendChild(buildDistrict(group, index));
        index += 1;
      });
    container.appendChild(section);
  });

  const empty = document.createElement('div');
  empty.className = 'explore-empty hidden';
  empty.id = 'explore-empty';
  empty.textContent = 'No sensor or district matches that.';
  container.appendChild(empty);
  builtFor = places;
}

function applyChip(host: HTMLElement, aqi: number | null) {
  const chip = host.querySelector(':scope > .explore-aqi') as HTMLElement | null;
  if (!chip) return;
  chip.classList.remove('skeleton-line');
  if (aqi === null) {
    chip.textContent = '--';
    chip.style.background = '';
    chip.style.color = '';
    chip.title = '';
    return;
  }
  const std = getAQIStandard();
  chip.textContent = String(aqi);
  chip.style.background = getAQIColor(aqi, std).hex;
  chip.style.color = aqiTextColor(aqi, std);
  chip.title = getAQICategory(aqi, std);
}

function paintChips() {
  if (!latestAqi) return;
  const byId = latestAqi;
  groups.forEach((group) => {
    let worst: number | null = null;
    group.places.forEach((place) => {
      const data = byId[place.id];
      const aqi = data ? zoneAqi(data) : null;
      const row = placeEls[place.id];
      if (row && !isEstimate(place)) {
        const offline = !data || (!!data.source && data.source.startsWith('openmeteo'));
        const label = row.querySelector('.place-kind, .district-sub');
        if (label) {
          const prefix = group.places.length === 1 ? `${place.name} · ` : '';
          label.innerHTML = offline
            ? `<span class="status-indicator offline"></span> ${prefix}Offline, showing a satellite estimate`
            : `<span class="status-indicator"></span> ${prefix}${group.places.length === 1 ? '1 sensor' : 'Live sensor'}`;
        }
      }
      if (row && group.places.length > 1) {
        applyChip(row, aqi);
      }
      if (aqi !== null && (worst === null || aqi > worst)) {
        worst = aqi;
      }
    });
    const head = districtEls[group.key]?.querySelector('.district-head') as HTMLElement | null;
    if (head) {
      applyChip(head, worst);
      const chip = head.querySelector(':scope > .explore-aqi') as HTMLElement | null;
      if (chip && group.places.length > 1 && worst !== null) {
        chip.title = `Worst in the district: ${chip.title}`;
      }
    }
  });
}

function applyFilter() {
  const needle = currentFilter.trim().toLowerCase();
  let anyVisible = false;

  groups.forEach((group) => {
    const card = districtEls[group.key];
    if (!card) return;
    const districtHit = group.district.toLowerCase().includes(needle);
    let matches = 0;
    group.places.forEach((place) => {
      const hit = !needle || districtHit || place.name.toLowerCase().includes(needle);
      if (hit) {
        matches += 1;
      }
      const row = placeEls[place.id];
      if (row && group.places.length > 1) {
        row.classList.toggle('hidden', !hit);
      }
    });
    card.classList.toggle('hidden', matches === 0);
    anyVisible = anyVisible || matches > 0;
    if (group.places.length > 1) {
      if (needle) {
        setExpanded(group, matches > 0);
      } else {
        setExpanded(group, openDistricts.has(group.key));
      }
    }
  });

  document.querySelectorAll<HTMLElement>('.explore-division').forEach((section) => {
    const visible = section.querySelector('.district-card:not(.hidden)');
    section.classList.toggle('hidden', !visible);
  });
  document.getElementById('explore-empty')?.classList.toggle('hidden', anyVisible);
}

export function initExplore(h: ExploreHandlers) {
  handlers = h;
}

export function renderExplore(places: Zone[], filter: string) {
  const container = document.getElementById('zone-list');
  if (!container) return;
  if (builtFor !== places) {
    build(container, places);
    paintChips();
  }
  currentFilter = filter;
  applyFilter();
}

export function setExploreData(byId: { [id: string]: AQIData | null }) {
  latestAqi = byId;
  paintChips();
}

export function repaintExplore() {
  paintChips();
}

export function revealDistrict(district: string) {
  const group = groups.find((g) => g.district === district);
  if (!group) return;
  if (group.places.length > 1) {
    openDistricts.add(group.key);
    saveOpenDistricts();
    setExpanded(group, true);
  }
  const card = districtEls[group.key];
  if (card) {
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
    requestAnimationFrame(() => card.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
}

export function syncExplorePin(id: string) {
  const host = placeEls[id];
  if (!host || !handlers) return;
  const btn = host.querySelector(':scope > .pin-btn') as HTMLElement | null;
  if (!btn) return;
  const pinned = handlers.isPinned(id);
  btn.classList.toggle('pinned', pinned);
  setPinIcon(btn, pinned);
  const name = host.dataset.placeName || 'place';
  btn.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${name}`);
}
