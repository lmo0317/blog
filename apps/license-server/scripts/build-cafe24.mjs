// Builds the license server as a cafe24 Node.js hosting app: cafe24 runs `node web.js` on an old Node (v14),
// so the bundle uses Express 4 and sql.js instead of Express 5 and node:sqlite. The app is pushed to
// cafe24's git repo, which deploys it.
// usage: node scripts/build-cafe24.mjs <out dir> <config json>
//   config json: { "LICENSE_ADMIN_SECRET": "...", ... } — copied as cafe24.config.json, read at start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , outArg, configArg] = process.argv;
if (!outArg || !configArg) throw new Error('usage: node scripts/build-cafe24.mjs <out dir> <config json>');
const out = path.resolve(outArg);

fs.mkdirSync(out, { recursive: true });
for (const entry of fs.readdirSync(out)) if (entry !== '.git') fs.rmSync(path.join(out, entry), { recursive: true, force: true });
for (const dir of ['lib', 'admin']) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
fs.copyFileSync(path.join(root, 'server.js'), path.join(out, 'server.js'));
fs.copyFileSync(path.resolve(configArg), path.join(out, 'cafe24.config.json'));

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

const { createLicenseServer } = await import('./server.js');
const { LicenseDatabase } = await import('./lib/db.js');
const { driver } = await import('./lib/sqlite.js');
const file = dataFile();
const { app } = createLicenseServer(new LicenseDatabase(file));
const port = Number(process.env.PORT) || 8001;
app.listen(port, () => console.log(\`[NeighborMate license] node \${process.version}, \${driver}, data \${file}, port \${port}\`));
`);
console.log(`built ${out}`);
