// Builds the license server as a cafe24 Node.js hosting app: cafe24 runs `node web.js` on an old Node (v14),
// so the bundle uses Express 4 and sql.js instead of Express 5 and node:sqlite. The app is pushed to
// cafe24's git repo, which deploys it.
// usage: node scripts/build-cafe24.mjs <out dir> <config json> [seed license.db]
//   config json: { "LICENSE_ADMIN_SECRET": "...", ... } — copied as cafe24.config.json, read at start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , outArg, configArg, seedArg] = process.argv;
if (!outArg || !configArg) throw new Error('usage: node scripts/build-cafe24.mjs <out dir> <config json>');
const out = path.resolve(outArg);

fs.mkdirSync(out, { recursive: true });
for (const entry of fs.readdirSync(out)) if (entry !== '.git') fs.rmSync(path.join(out, entry), { recursive: true, force: true });
for (const dir of ['lib', 'admin']) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
fs.copyFileSync(path.join(root, 'server.js'), path.join(out, 'server.js'));
fs.copyFileSync(path.resolve(configArg), path.join(out, 'cafe24.config.json'));
// The promo site (apps/landing) is the home page here. cafe24 meters traffic, so the 5MB promo video stays
// off: the phone frame shows its first frame as a still picture instead.
const site = path.join(out, 'site');
const landing = path.resolve(root, '..', 'landing');
fs.mkdirSync(site, { recursive: true });
for (const page of ['index.html', 'about.html', 'qna.html', 'terms.html', 'privacy.html']) fs.copyFileSync(path.join(landing, page), path.join(site, page));
fs.cpSync(path.join(landing, 'assets'), path.join(site, 'assets'), { recursive: true, filter: (src) => !src.endsWith('.mp4') });
const home = path.join(site, 'index.html');
const stripped = fs.readFileSync(home, 'utf8')
  .replace(/<video id="promo"[\s\S]*?<\/video>\s*<button class="sound-btn"[^>]*>[^<]*<\/button>/, '<img src="assets/shorts-poster.webp?v=20261016" alt="블로그 켜두기만 한 9월 한 달, 서로이웃 694명 증가" width="540" height="960">')
  .replace(/<p class="phone-cap">[^<]*<\/p>/, '<p class="phone-cap">켜두기만 한 9월 한 달, 서로이웃 +694명</p>')
  .replace(/\s*\/\/ The promo video plays[\s\S]*?\r?\n  \}\);\r?\n/, '\n')
  .replace('</head>', '<style>.phone img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 29px; background: #0b1220; } @media (max-width: 640px) { .phone img { border-radius: 25px; } }</style>\n</head>');
if (/<video|neighbormate-shorts|soundBtn/.test(stripped)) throw new Error('promo video left in site/index.html');
fs.writeFileSync(home, stripped);
// Pages only this site has (cafe24-site/): the 이웃메이트 라이트 download page.
fs.cpSync(path.join(root, 'cafe24-site'), site, { recursive: true });
if (seedArg) { fs.mkdirSync(path.join(out, 'seed'), { recursive: true }); fs.copyFileSync(path.resolve(seedArg), path.join(out, 'seed', 'license.db')); }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'package.json'), `${JSON.stringify({
  name: 'neighbormate-license-cafe24',
  version: pkg.version,
  private: true,
  type: 'module',
  main: 'web.js',
  scripts: { start: 'node web.js' },
  dependencies: { express: '4.21.2', 'sql.js': pkg.dependencies['sql.js'] }
}, null, 2)}\n`);

fs.writeFileSync(path.join(out, 'web.js'), `// cafe24 entry: settings from cafe24.config.json, data outside the app folder so a deploy never wipes it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(here, 'cafe24.config.json'), 'utf8'));
for (const [key, value] of Object.entries(config)) if (process.env[key] === undefined) process.env[key] = String(value);

function dataFile() {
  for (const dir of [path.resolve(here, '..', '..', 'nm-license-data'), path.join(here, 'data')]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return path.join(dir, 'license.db');
    } catch {}
  }
  throw new Error('no writable data folder');
}

// A database copied from another server (seed/license.db) replaces the data once, the first start after it arrives.
function applySeed(file) {
  const seed = path.join(here, 'seed', 'license.db');
  if (!fs.existsSync(seed)) return;
  const stamp = String(fs.statSync(seed).size) + ':' + crypto.createHash('sha256').update(fs.readFileSync(seed)).digest('hex');
  const marker = file + '.seed';
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === stamp) return;
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.before-seed-' + Date.now());
  fs.copyFileSync(seed, file);
  fs.writeFileSync(marker, stamp);
  console.log('[NeighborMate license] data replaced from seed/license.db');
}

// 이웃메이트 라이트 is served from Google Drive: its latest.yml there names the current installer's direct link.
// Node 14 has no fetch, so this follows Drive's redirects with https.get. Cached for 5 minutes.
const LITE_FEED = 'https://drive.usercontent.google.com/download?id=1VevdRNhh0q-n-e-SM9qRmS8gIEPAWSOw&export=download';
const getText = (url, hops = 5) => new Promise((resolve, reject) => {
  https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) { res.resume(); resolve(getText(new URL(res.headers.location, url).href, hops - 1)); return; }
    if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => resolve(body));
  }).on('error', reject).setTimeout(10000, function () { this.destroy(new Error('timeout')); });
});
let liteCache = { at: 0, feed: null };
async function liteFeed() {
  if (liteCache.feed && Date.now() - liteCache.at < 5 * 60 * 1000) return liteCache.feed;
  const text = await getText(LITE_FEED);
  const pick = (key) => ((text.match(new RegExp('^' + key + ":\\\\s*'?([^'\\\\r\\\\n]*)", 'm')) || [])[1] || '').trim();
  const feed = { version: pick('version'), path: pick('path') };
  if (!feed.version || !/^https:\\/\\/drive\\.usercontent\\.google\\.com\\//.test(feed.path)) throw new Error('bad feed');
  liteCache = { at: Date.now(), feed };
  return feed;
}

const { createLicenseServer } = await import('./server.js');
const { LicenseDatabase } = await import('./lib/db.js');
const { driver } = await import('./lib/sqlite.js');
const file = dataFile();
applySeed(file);
const { default: express } = await import('express');
const { app } = createLicenseServer(new LicenseDatabase(file));
// The promo site at /, the license server at /license (the paths the site and the app use) and at / as before.
const web = express();
web.use('/license', app);
web.get('/lite/latest.json', async (req, res) => {
  try { const feed = await liteFeed(); res.json({ version: feed.version }); } catch { res.status(502).json({ error: 'feed unavailable' }); }
});
web.get('/lite/download', async (req, res) => {
  try { res.redirect(302, (await liteFeed()).path); } catch { res.status(502).send('다운로드 서버에 잠시 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'); }
});
web.use(express.static(path.join(here, 'site')));
web.use(app);
const port = Number(process.env.PORT) || 8001;
web.listen(port, () => console.log(\`[NeighborMate license] node \${process.version}, \${driver}, data \${file}, port \${port}\`));
`);
console.log(`built ${out}`);
