import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_URL } from '../assets/js/config.js';
import { buildDistrictAverages } from '../assets/js/districts.js';
import {
  SITE_URL,
  areasHeading,
  districtMembers,
  historyTitle,
  placeDescription,
  placeHeading,
  placeIntro,
  placeTitle,
  viewMeta,
} from '../assets/js/seo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const COPY = [
  'assets/css',
  'assets/images',
  'assets/js',
  'privacy',
  'funding.json',
  'llms.txt',
  'manifest.json',
  'robots.txt',
  'sw.js',
];
const DIVISION_STATE = {
  Jammu: 'Jammu and Kashmir',
  Kashmir: 'Jammu and Kashmir',
  Ladakh: 'Ladakh',
};

async function getZones(query) {
  const res = await fetch(`${API_URL}/zones${query}`);
  if (!res.ok) {
    throw new Error(`${API_URL}/zones${query} returned ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data.zones) || data.zones.length === 0) {
    throw new Error(`${API_URL}/zones${query} returned no zones`);
  }
  return data.zones;
}

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function zoneUrl(id) {
  return `/zone/${encodeURIComponent(id)}`;
}

function swap(html, pattern, replacement) {
  if (!pattern.test(html)) {
    throw new Error(`template is missing ${pattern}`);
  }
  return html.replace(pattern, () => replacement);
}

function jsonLd(graph) {
  const body = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);
  return `<script type="application/ld+json">\n${body.replace(/</g, '\\u003c')}\n    </script>`;
}

function placeLd(place, url, members) {
  const state = DIVISION_STATE[place.division];
  const area = [];
  if (place.district) {
    area.push({ '@type': 'AdministrativeArea', name: `${place.district} district` });
  }
  if (state) {
    area.push({ '@type': 'AdministrativeArea', name: state });
  }
  const placeNode = {
    '@type': 'Place',
    '@id': `${url}#place`,
    name: place.kind === 'district' ? place.district : place.name,
    geo: { '@type': 'GeoCoordinates', latitude: place.lat, longitude: place.lon },
  };
  if (area.length > 0) {
    placeNode.containedInPlace = area[0];
    if (area.length > 1) {
      area[0].containedInPlace = area[1];
    }
  }
  const crumbs = [
    { name: 'Breathe', item: `${SITE_URL}/` },
    { name: 'Explore', item: `${SITE_URL}/explore` },
    { name: placeHeading(place), item: url },
  ];
  return jsonLd([
    {
      '@type': 'WebPage',
      '@id': url,
      url,
      name: placeTitle(place),
      description: placeDescription(place, members),
      about: { '@id': `${url}#place` },
      breadcrumb: { '@id': `${url}#breadcrumb` },
      publisher: { '@type': 'Organization', name: 'breatheOSS', url: SITE_URL },
    },
    placeNode,
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: c.item,
      })),
    },
  ]);
}

function staticIndex(pages) {
  const byDivision = new Map();
  pages.forEach((place) => {
    const division = place.division || 'Other';
    if (!byDivision.has(division)) {
      byDivision.set(division, []);
    }
    byDivision.get(division).push(place);
  });
  const sections = [...byDivision.entries()].map(([division, places]) => {
    const items = places
      .slice()
      .sort(
        (a, b) => (a.district || '').localeCompare(b.district || '') || a.name.localeCompare(b.name)
      )
      .map((p) => {
        const label = p.kind === 'district' ? placeHeading(p) : `${p.name}, ${p.district} district`;
        return `<li><a class="place-link" href="${zoneUrl(p.id)}">${esc(label)}</a></li>`;
      })
      .join('');
    return `<h2 class="section-title">${esc(division)} division</h2><ul class="place-areas-list">${items}</ul>`;
  });
  return `<div class="static-index">${sections.join('')}</div>`;
}

function page(template, opts) {
  let html = template;
  const url = opts.route === null ? null : `${SITE_URL}${opts.route}`;
  html = swap(html, /<title>[\s\S]*?<\/title>/, `<title>${esc(opts.title)}</title>`);
  html = swap(
    html,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
    `<meta name="description" content="${esc(opts.description)}" />`
  );
  html = swap(
    html,
    /<meta property="og:title" content="[^"]*" \/>/,
    `<meta property="og:title" content="${esc(opts.title)}" />`
  );
  html = swap(
    html,
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:description" content="${esc(opts.description)}" />`
  );
  const head = [];
  if (url !== null) {
    head.push(`<link rel="canonical" href="${esc(url)}" />`);
    head.push(`<meta property="og:url" content="${esc(url)}" />`);
  }
  if (opts.noindex) {
    head.push('<meta name="robots" content="noindex, follow" />');
  }
  html = swap(html, /<\/head>/, `    ${head.join('\n    ')}\n  </head>`);
  if (opts.ld !== undefined) {
    html = swap(html, /<script type="application\/ld\+json">[\s\S]*?<\/script>/, opts.ld);
  }
  html = swap(
    html,
    /<div id="zone-list" class="content-scroll explore-list"><\/div>/,
    `<div id="zone-list" class="content-scroll explore-list">${opts.index}</div>`
  );
  if (opts.edit) {
    html = opts.edit(html);
  }
  return html;
}

function injectHero(html, heading, intro, bodyHtml = '') {
  const heroHtml =
    `<body>\n    <section class="place-hero" id="seo-hero">\n` +
    `      <h1>${esc(heading)}</h1>\n` +
    `      <p class="place-intro">${esc(intro)}</p>\n` +
    (bodyHtml ? `      ${bodyHtml}\n` : '') +
    `    </section>`;

  html = swap(html, /<body>/, heroHtml);
  html = swap(
    html,
    /<noscript>[\s\S]*?<\/noscript>/,
    '<noscript><p class="place-hero-noscript">Live readings and charts require JavaScript.</p></noscript>'
  );
  return html;
}

function detailEdit(place, members) {
  return (html) => {
    const heading = placeHeading(place);
    const intro = placeIntro(place, members);
    const items = members
      .map(
        (m) =>
          `<li><a class="place-link" href="${zoneUrl(m.id)}" data-place-id="${esc(m.id)}">${esc(m.name)}</a></li>`
      )
      .join('');
    const areasHtml =
      members.length > 0
        ? `<div class="place-areas"><h2 class="section-title">${esc(areasHeading(place))}</h2><ul class="place-areas-list">${items}</ul></div>`
        : '';

    html = injectHero(html, heading, intro, areasHtml);
    html = swap(
      html,
      /<h1 id="detail-title-header">[^<]*<\/h1>/,
      `<h1 id="detail-title-header">${esc(heading)}</h1>`
    );
    html = swap(
      html,
      /<div class="now-viewing-name" id="detail-zone-name">[^<]*<\/div>/,
      `<div class="now-viewing-name" id="detail-zone-name">${esc(place.name)}</div>`
    );
    html = swap(
      html,
      /<p class="place-intro" id="detail-intro"><\/p>/,
      `<p class="place-intro" id="detail-intro">${esc(intro)}</p>`
    );
    if (members.length > 0) {
      html = swap(
        html,
        /<div class="place-areas hidden" id="detail-areas">/,
        '<div class="place-areas" id="detail-areas">'
      );
      html = swap(
        html,
        /<h2 class="section-title" id="detail-areas-title"><\/h2>/,
        `<h2 class="section-title" id="detail-areas-title">${esc(areasHeading(place))}</h2>`
      );
      html = swap(
        html,
        /<ul class="place-areas-list" id="detail-areas-list"><\/ul>/,
        `<ul class="place-areas-list" id="detail-areas-list">${items}</ul>`
      );
    }
    return html;
  };
}

function historyEdit(place) {
  return (html) =>
    swap(
      html,
      /<h1 id="history-title-header">[^<]*<\/h1>/,
      `<h1 id="history-title-header">${esc(place.name)} History</h1>`
    );
}

function write(file, content) {
  const full = path.join(OUT, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const places = await getZones('?layout=sensors');
const legacy = await getZones('');
const districts = buildDistrictAverages(legacy, places);
const pages = [...districts, ...places];
const known = new Set(pages.map((p) => p.id));
const template = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const index = staticIndex(pages);

fs.rmSync(OUT, { recursive: true, force: true });
COPY.forEach((entry) => {
  fs.cpSync(path.join(ROOT, entry), path.join(OUT, entry), { recursive: true });
});

const homeHero = (html) =>
  injectHero(
    html,
    'Live air quality for Jammu & Kashmir and Ladakh',
    'Breathe (BreatheOSS) is a free, open-source air quality network for Jammu & Kashmir and Ladakh. Real-time AQI comes from our own AirGradient ground sensors, with CAMS satellite fallback where there is no sensor, shown in both US EPA AQI and Indian NAQI, with a live map and history for every district in the Jammu, Kashmir and Ladakh divisions.',
    '<ul class="place-areas-list">' +
      '<li><a class="place-link" href="/zone/srinagar">Srinagar AQI</a></li>' +
      '<li><a class="place-link" href="/zone/jammu_city">Jammu AQI</a></li>' +
      '<li><a class="place-link" href="/explore">AQI by district</a></li>' +
      '<li><a class="place-link" href="/map">Live map</a></li>' +
      '</ul>'
  );

write('index.html', page(template, { route: '/', ...viewMeta('dashboard'), index, edit: homeHero }));
write(
  '404.html',
  page(template, {
    route: null,
    title: 'Page not found | Breathe',
    description: 'This page does not exist on Breathe.',
    noindex: true,
    ld: '',
    index,
  })
);

['map', 'explore', 'settings'].forEach((view) => {
  const meta = viewMeta(view);
  const heading = meta.title.replace(/\s*\|\s*Breathe$/, '');
  const edit =
    view === 'settings'
      ? undefined
      : (html) => injectHero(html, heading, meta.description, view === 'explore' ? index : '');
  write(
    `${view}.html`,
    page(template, { route: `/${view}`, ...meta, noindex: view === 'settings', index, edit })
  );
});

pages.forEach((place) => {
  const members = place.kind === 'district' ? districtMembers(place, places) : [];
  const route = zoneUrl(place.id);
  const url = `${SITE_URL}${route}`;
  const description = placeDescription(place, members);
  write(
    `zone/${place.id}.html`,
    page(template, {
      route,
      title: placeTitle(place),
      description,
      ld: placeLd(place, url, members),
      index,
      edit: detailEdit(place, members),
    })
  );
  if (place.kind !== 'estimate' && place.provider !== 'openmeteo') {
    write(
      `zone/${place.id}/history.html`,
      page(template, {
        route: `${route}/history`,
        title: historyTitle(place),
        description,
        noindex: true,
        ld: '',
        index,
        edit: historyEdit(place),
      })
    );
  }
});

const redirects = [];
legacy.forEach((zone) => {
  if (known.has(zone.id)) {
    return;
  }
  const members = places.filter((p) => p.legacy_zone === zone.id);
  if (members.length !== 1) {
    return;
  }
  const to = zoneUrl(members[0].id);
  redirects.push(`${zoneUrl(zone.id)} ${to} 301`);
  redirects.push(`${zoneUrl(zone.id)}/history ${to}/history 301`);
  redirects.push(
    `/map/${encodeURIComponent(zone.id)} /map/${encodeURIComponent(members[0].id)} 301`
  );
});
places.forEach((place) => {
  if (place.kind === 'estimate' || place.provider === 'openmeteo') {
    return;
  }
  const route = zoneUrl(place.id);
  redirects.push(`${route}-raw ${route} 200`);
  redirects.push(`${route}-raw/history ${route}/history 200`);
});
redirects.push('/map/* /map 200');
write('_redirects', `${redirects.join('\n')}\n`);

const urls = ['/', '/map', '/explore', ...pages.map((p) => zoneUrl(p.id)), '/privacy/'];
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${esc(SITE_URL + u)}</loc></url>`)
    .join('\n')}\n</urlset>\n`
);

const INDEXNOW_KEY = 'ada7ed50e8d2452bb798c69fba7e1d6c';
write(`${INDEXNOW_KEY}.txt`, INDEXNOW_KEY);

console.log(
  `prerendered ${pages.length} places, ${districts.length} districts, ${redirects.length} redirects`
);
