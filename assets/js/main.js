const API_URL = "https://api.breatheoss.app"; 

let allZones = [];
let pinnedZoneIds = JSON.parse(localStorage.getItem('breathe_pinned_zones')) || [];
let mapInstance = null;
let detailChart = null;
let mapTileLayer = null;

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    await fetchZones();
    renderDashboard();
    updateNavHighlight('dashboard');
    
    document.getElementById('zone-search').addEventListener('input', (e) => {
        renderExploreList(e.target.value);
    });
});

function initTheme() {
    const toggle = document.getElementById('theme-toggle');
    const savedTheme = localStorage.getItem('theme') || 'dark';
    
    document.documentElement.setAttribute('data-theme', savedTheme);
    toggle.checked = (savedTheme === 'dark');

    toggle.addEventListener('change', (e) => {
        const newTheme = e.target.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        
        if(detailChart) detailChart.update();
        if(mapInstance) updateMapTiles(newTheme);
    });
}

async function fetchZones() {
    try {
        const res = await fetch(`${API_URL}/zones`);
        const data = await res.json();
        allZones = data.zones;
    } catch (e) { console.error("Fetch failed", e); }
}

async function getZoneAQI(zoneId) {
    try {
        const res = await fetch(`${API_URL}/aqi/${zoneId}`);
        return await res.json();
    } catch (e) { return null; }
}

async function renderDashboard() {
    const container = document.getElementById('pinned-container');
    const emptyState = document.getElementById('empty-state');
    container.innerHTML = '';
    
    if (pinnedZoneIds.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    for (const id of pinnedZoneIds) {
        const zoneConfig = allZones.find(z => z.id === id);
        if (!zoneConfig) continue;

        const data = await getZoneAQI(id);
        if (!data) continue;

        const colorClass = getAQIColor(data.aqi).bg;

        const card = document.createElement('div');
        card.className = 'dashboard-card';
        card.onclick = () => openZoneDetails(id);
        card.innerHTML = `
            <div>
                <h3 style="margin:0; font-size:18px;">${zoneConfig.name}</h3>
                <p style="margin:4px 0 0 0; color:var(--on-surface-variant); font-size:12px;">
                    ${data.main_pollutant.toUpperCase()}
                </p>
            </div>
            <div class="aqi-badge-small ${colorClass}">
                ${data.aqi}
            </div>
        `;
        container.appendChild(card);
    }
}

function renderExploreList(filter = "") {
    const container = document.getElementById('zone-list');
    container.innerHTML = '';

    const filtered = allZones.filter(z => z.name.toLowerCase().includes(filter.toLowerCase()));

    filtered.forEach(z => {
        const isPinned = pinnedZoneIds.includes(z.id);
        const div = document.createElement('div');
        div.className = 'explore-card';
        
        div.innerHTML = `
            <div>
                <div style="font-weight:500; font-size:16px; margin-bottom:4px;">${z.name}</div>
                <div style="font-size:12px; color:var(--on-surface-variant);">${z.provider || 'openmeteo'}</div>
            </div>
            <button class="pin-btn ${isPinned ? 'pinned' : ''}" onclick="togglePin('${z.id}', this)">
                <svg viewBox="0 0 24 24"><path d="M16 9V4l1 1c.55.55 1.45.55 2 0s.55-1.45 0-2l-7-7-7 7c-.55.55-.55 1.45 0 2s1.45.55 2 0l1-1v5c0 1.66-1.34 3-3 3h-1v2h12v-2h-1c-1.66 0-3-1.34-3-3zM12 2C13 2 14 3 14 4V9H10V4C10 3 11 2 12 2M12 14C13.5 14 15 13 15 11.5V10H9V11.5C9 13 10.5 14 12 14Z" transform="rotate(45 12 12)"/></svg>
            </button>
        `;
        container.appendChild(div);
    });
}

function togglePin(id, btn) {
    if (pinnedZoneIds.includes(id)) {
        pinnedZoneIds = pinnedZoneIds.filter(zid => zid !== id);
        btn.classList.remove('pinned');
    } else {
        pinnedZoneIds.push(id);
        btn.classList.add('pinned');
    }
    localStorage.setItem('breathe_pinned_zones', JSON.stringify(pinnedZoneIds));
    renderDashboard();
}

async function openZoneDetails(zoneId) {
    showView('details');
    
    const zoneConfig = allZones.find(z => z.id === zoneId);
    if(zoneConfig) document.getElementById('detail-title-header').innerText = zoneConfig.name;

    const data = await getZoneAQI(zoneId);
    if (!data) return;

    const colors = getAQIColor(data.aqi);
    const aqiEl = document.getElementById('detail-aqi');
    const chipEl = document.querySelector('.naqi-chip');
    
    aqiEl.innerText = data.aqi;
    aqiEl.style.color = colors.hex; 
    
    chipEl.style.backgroundColor = colors.hex; 
    
    document.getElementById('detail-primary').innerText = `Primary: ${data.main_pollutant.toUpperCase()}`;
    
    const now = Date.now() / 1000;
    const diff = Math.floor((now - data.timestamp_unix) / 60);
    document.getElementById('detail-updated').innerText = `Updated ${diff} min ago`;

    renderDetailChart(data.history);
    renderPollutantGrid(data.concentrations_us_units || {});
}

function renderDetailChart(history) {
    const ctx = document.getElementById('detailChart').getContext('2d');
    if (detailChart) detailChart.destroy();

    const sorted = history.sort((a, b) => a.ts - b.ts);
    const labels = sorted.map(h => {
        const d = new Date(h.ts * 1000);
        return `${d.getHours()}:00`;
    });
    const values = sorted.map(h => h.aqi);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const lineColor = '#a8c7fa'; 
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, isDark ? 'rgba(168, 199, 250, 0.4)' : 'rgba(65, 105, 225, 0.4)');
    gradient.addColorStop(1, isDark ? 'rgba(168, 199, 250, 0.0)' : 'rgba(65, 105, 225, 0.0)');

    detailChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                borderColor: lineColor,
                backgroundColor: gradient,
                borderWidth: 2,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 6,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: { 
                legend: { display: false }, 
                tooltip: { enabled: true } 
            },
            scales: {
                x: { display: false }, 
                y: { display: false, min: 0 } 
            },
            layout: { padding: 0 }
        }
    });
}

function renderPollutantGrid(comps) {
    const container = document.getElementById('pollutant-grid');
    container.innerHTML = '';

    const defs = [
        { key: 'pm2_5', label: 'PM2.5', unit: 'µg/m³' },
        { key: 'co',    label: 'CO',    unit: 'mg/m³' },
        { key: 'pm10',  label: 'PM10',  unit: 'µg/m³' },
        { key: 'so2',   label: 'SO₂',   unit: 'µg/m³' },
        { key: 'no2',   label: 'NO₂',   unit: 'µg/m³' },
        { key: 'o3',    label: 'O₃',    unit: 'µg/m³' }
    ];

    defs.forEach(def => {
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

function initMap() {
    if (mapInstance) return;
    mapInstance = L.map('map-container', { zoomControl: false }).setView([33.9, 75.5], 8);
    
    updateMapTiles(document.documentElement.getAttribute('data-theme'));

    allZones.forEach(async (z) => {
        if (!z.lat || !z.lon) return;

        const data = await getZoneAQI(z.id);
        if (!data) return;

        const colorClass = getAQIColor(data.aqi).bg;
        const style = getComputedStyle(document.documentElement);
        const hex = style.getPropertyValue(`--aqi-${colorClass.replace('bg-', '')}`).trim();

        const markerHtml = `
            <div style="
                background-color: ${hex};
                width: 24px; height: 24px;
                border-radius: 50%;
                border: 2px solid #fff;
                display: flex; align-items: center; justify-content: center;
                color: #000; font-weight: bold; font-size: 10px;
                box-shadow: 0 0 10px rgba(0,0,0,0.5);
            ">${data.aqi}</div>
        `;

        const icon = L.divIcon({
            html: markerHtml,
            className: 'custom-pin',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        L.marker([z.lat, z.lon], { icon: icon })
            .addTo(mapInstance)
            .bindPopup(`
                <div style="text-align:center; color:#333;">
                    <h3 style="margin:0">${z.name}</h3>
                    <div style="font-size:24px; font-weight:bold; margin:5px 0;">${data.aqi} AQI</div>
                    <small>Primary: ${data.main_pollutant.toUpperCase()}</small>
                </div>
            `);
    });
}

function updateMapTiles(theme) {
    if (mapTileLayer) mapTileLayer.remove();
    
    const url = theme === 'light' 
        ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    mapTileLayer = L.tileLayer(url, {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19
    }).addTo(mapInstance);
}

function showView(viewName) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active-view'));
    document.getElementById(`view-${viewName}`).classList.add('active-view');
    updateNavHighlight(viewName);

    if (viewName === 'map') {
        setTimeout(() => {
            initMap();
            if(mapInstance) mapInstance.invalidateSize();
        }, 100);
    }
    if (viewName === 'explore') {
        renderExploreList(document.getElementById('zone-search').value);
    }
}

function updateNavHighlight(viewName) {
    document.querySelectorAll('.nav-item, .nav-btn').forEach(el => el.classList.remove('active'));
    
    let target = viewName;
    if(viewName === 'details') target = 'dashboard';

    const mobBtn = document.getElementById(`nav-${target}`);
    if (mobBtn) mobBtn.classList.add('active');

    const sideBtn = document.getElementById(`side-${target}`);
    if (sideBtn) sideBtn.classList.add('active');
}

function getAQIColor(aqi) {
    const style = getComputedStyle(document.documentElement);
    
    if (aqi <= 50) return { bg: 'bg-good', hex: style.getPropertyValue('--aqi-good').trim() };
    if (aqi <= 100) return { bg: 'bg-satisfactory', hex: style.getPropertyValue('--aqi-satisfactory').trim() };
    if (aqi <= 200) return { bg: 'bg-moderate', hex: style.getPropertyValue('--aqi-moderate').trim() };
    if (aqi <= 300) return { bg: 'bg-poor', hex: style.getPropertyValue('--aqi-poor').trim() };
    if (aqi <= 400) return { bg: 'bg-very-poor', hex: style.getPropertyValue('--aqi-very-poor').trim() };
    return { bg: 'bg-severe', hex: style.getPropertyValue('--aqi-severe').trim() };
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }