import fs from 'node:fs';

const HOST = 'breatheoss.app';
const KEY = 'ada7ed50e8d2452bb798c69fba7e1d6c';
const KEY_URL = `https://${HOST}/${KEY}.txt`;
const SITEMAP_PATH = new URL('../dist/sitemap.xml', import.meta.url);

const k = await fetch(KEY_URL, { cache: 'no-store' });
if (!k.ok) throw new Error(`key file ${KEY_URL} → ${k.status} (deploy not finished?)`);
const body = (await k.text()).trim();
if (body !== KEY) throw new Error(`key file contains "${body}", expected "${KEY}"`);

const sitemap = fs.existsSync(SITEMAP_PATH)
  ? fs.readFileSync(SITEMAP_PATH, 'utf8')
  : await (async () => {
      const s = await fetch(`https://${HOST}/sitemap.xml`, { cache: 'no-store' });
      if (!s.ok) throw new Error(`sitemap https://${HOST}/sitemap.xml → ${s.status}`);
      return s.text();
    })();
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (urlList.length === 0) throw new Error('no URLs found in sitemap.xml');

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_URL, urlList }),
});

console.log(`IndexNow ${res.status} ${res.statusText} — ${urlList.length} URLs`);
if (![200, 202].includes(res.status)) process.exit(1);
