// One command release: bumps the patch version, builds the installer and uploads it to the
// 112 update server. Installed apps pick it up within 4 hours (or on their next start).
//   npm run release            → 1.0.1 → 1.0.2
//   npm run release -- 1.2.0   → that exact version
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = 'lmo0317@192.168.219.112';
const REMOTE_DIR = '/var/www/neighbormate-updates';

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const next = process.argv[2] || `${major}.${minor}.${patch + 1}`;
if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error(`버전 형식이 아닙니다: ${next}`);
pkg.version = next;
await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`▶ 버전 ${next}`);

await import('./build-installer.mjs');

const dist = path.join(root, 'dist');
const files = [`NeighborMate-Setup-${next}.exe`, `NeighborMate-Setup-${next}.exe.blockmap`].map((name) => path.join(dist, name));
const ssh = ['-o', 'StrictHostKeyChecking=no'];
console.log('\n▶ 업데이트 서버에 올리는 중');
execFileSync('scp', [...ssh, ...files, `${SERVER}:${REMOTE_DIR}/`], { stdio: 'inherit' });
// latest.yml goes last, so apps never see a version whose installer is still uploading.
execFileSync('scp', [...ssh, path.join(dist, 'latest.yml'), `${SERVER}:${REMOTE_DIR}/latest.yml.tmp`], { stdio: 'inherit' });
// Keep the newest three installers so in-flight downloads finish. NeighborMate-Setup.exe is the
// promo page's download link and always points at the newest installer.
execFileSync('ssh', [...ssh, SERVER, `cd ${REMOTE_DIR} && mv latest.yml.tmp latest.yml && ln -sfn NeighborMate-Setup-${next}.exe NeighborMate-Setup.exe && ls -t NeighborMate-Setup-*.exe | tail -n +4 | while read f; do rm -f "$f" "$f.blockmap"; done`], { stdio: 'inherit' });

const published = await (await fetch('https://minohlee.mooo.com/updates/neighbormate/latest.yml', { cache: 'no-store' })).text();
if (!published.includes(`version: ${next}`)) throw new Error('업데이트 서버의 latest.yml이 새 버전으로 바뀌지 않았습니다.');
console.log(`\n✅ ${next} 배포 완료 — 설치된 앱이 자동으로 받아 갑니다.`);
