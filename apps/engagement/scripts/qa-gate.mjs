// The deploy gate: deploy:web and release run only when `npm run qa` passed on exactly this code.
// The code hash covers what ships (lib, public, server.js, main.js, updater.js, dependencies); the version
// number is left out so `release` (which bumps it) still matches the QA run.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const QA_RECORD = path.join(root, '.qa', 'last-run.json');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

export function codeHash() {
  const hash = crypto.createHash('sha256');
  const shipped = [...files(path.join(root, 'lib')), ...files(path.join(root, 'public')), ...['server.js', 'main.js', 'updater.js'].map((name) => path.join(root, name))]
    .filter((file) => fs.existsSync(file)).sort();
  for (const file of shipped) {
    hash.update(path.relative(root, file).replace(/\\/g, '/'));
    hash.update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  hash.update(JSON.stringify({ dependencies: pkg.dependencies, scripts: pkg.scripts }));
  return hash.digest('hex');
}

export function requireQaPass(what) {
  const fail = (why) => {
    console.error(`\n⛔ ${what} 중단: ${why}\n   먼저 \`npm run qa\`를 돌려 통과시키세요.\n`);
    process.exit(1);
  };
  if (!fs.existsSync(QA_RECORD)) fail('QA를 돌린 기록이 없습니다.');
  const last = JSON.parse(fs.readFileSync(QA_RECORD, 'utf8'));
  if (!last.ok) fail('마지막 QA가 실패했습니다.');
  if (last.hash !== codeHash()) fail('QA를 통과한 뒤 코드가 바뀌었습니다.');
  if (Date.now() - Date.parse(last.at) > MAX_AGE_MS) fail('QA 통과가 24시간보다 오래됐습니다.');
  console.log(`▶ QA 통과 확인 (${new Date(last.at).toLocaleString('ko-KR')})`);
}
