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

const { createLicenseServer } = await import('./server.js');
const { LicenseDatabase } = await import('./lib/db.js');
const { driver } = await import('./lib/sqlite.js');
const file = dataFile();
applySeed(file);
const { app } = createLicenseServer(new LicenseDatabase(file));
const port = Number(process.env.PORT) || 8001;
app.listen(port, () => console.log(\`[NeighborMate license] node \${process.version}, \${driver}, data \${file}, port \${port}\`));
`);
console.log(`built ${out}`);
