// Uploads the promo site (home, 기능 소개) to the 112 server: https://minohlee.mooo.com/neighbormate-app/
//   node apps/landing/deploy.mjs
// The download buttons point at /updates/neighbormate/NeighborMate-Setup.exe, a link that
// apps/engagement's `npm run release` moves to each new installer.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const SERVER = 'lmo0317@192.168.219.112';
const REMOTE_DIR = '/var/www/neighbormate-site';
const ssh = ['-o', 'StrictHostKeyChecking=no'];

execFileSync('scp', [...ssh, '-r', ...['index.html', 'about.html', 'assets'].map((f) => path.join(root, f)), `${SERVER}:${REMOTE_DIR}/`], { stdio: 'inherit' });

for (const page of ['', 'about.html']) {
  const res = await fetch(`https://minohlee.mooo.com/neighbormate-app/${page}`, { cache: 'no-store' });
  const html = await res.text();
  if (!res.ok || !html.includes('이웃메이트')) throw new Error(`${page || 'index.html'} 확인 실패 (HTTP ${res.status})`);
}
console.log('✅ https://minohlee.mooo.com/neighbormate-app/ 배포 완료');
