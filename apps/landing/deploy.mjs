// Uploads the promo page to the 112 server: https://minohlee.mooo.com/neighbormate-app/
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

execFileSync('scp', [...ssh, '-r', path.join(root, 'index.html'), path.join(root, 'assets'), `${SERVER}:${REMOTE_DIR}/`], { stdio: 'inherit' });

const res = await fetch('https://minohlee.mooo.com/neighbormate-app/', { cache: 'no-store' });
const html = await res.text();
if (!res.ok || !html.includes('이웃메이트')) throw new Error(`홍보 페이지 확인 실패 (HTTP ${res.status})`);
console.log('✅ https://minohlee.mooo.com/neighbormate-app/ 배포 완료');
