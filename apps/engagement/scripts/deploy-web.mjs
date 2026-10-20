// Deploys the web build (https://minohlee.mooo.com/neighbormate/) to the 112 server: backs up the
// running copy, uploads lib/public/server, installs missing packages and restarts the service.
//   npm run deploy:web
// Then test it on the web, and only after that ship the desktop update with `npm run release`.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireQaPass } from './qa-gate.mjs';

requireQaPass('웹 배포');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = 'lmo0317@192.168.219.112';
const REMOTE_DIR = '/home/lmo0317/apps/blog-engage';
const SERVICE = 'blog-engage';
const ssh = ['-o', 'StrictHostKeyChecking=no'];
const remote = (command) => execFileSync('ssh', [...ssh, SERVER, command], { encoding: 'utf8' }).trim();

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
console.log('▶ 서버의 지금 버전을 백업하는 중');
remote(`mkdir -p ~/backups/blog-engage-${stamp} && cd ${REMOTE_DIR} && cp -r lib public server.js main.js package.json ~/backups/blog-engage-${stamp}/`);

console.log('▶ 올리는 중');
execFileSync('scp', [...ssh, '-r', ...['lib', 'public', 'server.js', 'main.js', 'package.json'].map((f) => path.join(root, f)), `${SERVER}:${REMOTE_DIR}/`], { stdio: 'inherit' });

// Install only when a dependency is missing (the web build skips electron and other dev packages).
const missing = remote(`cd ${REMOTE_DIR} && export PATH=$HOME/.local/node-v22/bin:$PATH && node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies||{}).filter((d)=>{try{require.resolve(d+'/package.json');return false}catch{return true}}).join(' '))"`);
if (missing) {
  console.log(`▶ 패키지 설치: ${missing}`);
  remote(`cd ${REMOTE_DIR} && export PATH=$HOME/.local/node-v22/bin:$PATH && npm install --omit=dev --no-audit --no-fund`);
}

console.log('▶ 서비스 재시작');
remote(`systemctl --user restart ${SERVICE}`);
let healthy = false;
for (let i = 0; i < 20 && !healthy; i++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  // Without the login cookie the server answers 401 — that still means it is up.
  healthy = /^(200|401)$/.test(remote(`curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:4310/api/health || true`));
}
if (!healthy) {
  throw new Error(`${SERVICE}가 뜨지 않았습니다. 백업: ~/backups/blog-engage-${stamp}\n${remote(`journalctl --user -u ${SERVICE} -n 30 --no-pager || true`)}`);
}
console.log(`\n✅ 웹 배포 완료 — https://minohlee.mooo.com/neighbormate/ (백업: ~/backups/blog-engage-${stamp})`);
