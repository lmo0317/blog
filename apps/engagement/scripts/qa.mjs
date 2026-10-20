// QA before every deploy: `npm run qa`. deploy:web and release refuse to run until QA has passed on exactly
// the code being shipped (see qa-gate.mjs). What each stage covers is listed in .agents/skills/qa/SKILL.md.
//   1. Static: syntax check + unit tests (engagement), license server tests on node:sqlite and sql.js
//   2. Replies: the 171 real comments routed and answered without E2B; no empty or broken reply
//   3. Live Naver on 112 with this code: read posts, post a secret comment, reply under it, check the real
//      page (once, under the right comment, not as a new comment), delete both
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeHash, QA_RECORD } from './qa-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..', '..');
const SERVER = 'lmo0317@192.168.219.112';
const NODE = '~/.local/node-v22/bin/node';
// A post of the owner's own blog that collects the QA comment for a minute (secret, deleted after).
const QA_POST = process.env.NM_QA_POST || 'https://blog.naver.com/lmo0317/224401793308';
const ssh = ['-o', 'StrictHostKeyChecking=no'];
const results = [];
const record = (stage, name, ok, detail = '') => {
  results.push({ stage, name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${String(detail).split('\n')[0].slice(0, 160)}` : ''}`);
};
const run = (cmd, args, cwd, env = {}) => spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', shell: process.platform === 'win32' });
const tally = (out) => `${(out.match(/^# pass (\d+)/m) || [])[1] || '?'} pass / ${(out.match(/^# fail (\d+)/m) || [])[1] || '?'} fail`;

const hash = codeHash();
console.log(`▶ QA 시작 (코드 ${hash.slice(0, 12)})`);

console.log('\n[1] 정적 검사·단위 테스트');
let r = run('npm', ['run', 'check'], root);
record('static', '문법 검사 (npm run check)', r.status === 0, r.status === 0 ? '' : (r.stderr || r.stdout).slice(-400));
r = run('npm', ['test'], root);
record('static', '이웃메이트 단위 테스트', r.status === 0, tally(r.stdout));
const license = path.join(repo, 'apps', 'license-server');
r = run('npm', ['test'], license);
record('static', '라이선스 서버 테스트 (node:sqlite)', r.status === 0, tally(r.stdout));
r = run('npm', ['test'], license, { NM_SQLITE_DRIVER: 'sql.js' });
record('static', '라이선스 서버 테스트 (sql.js, cafe24용)', r.status === 0, tally(r.stdout));

console.log('\n[2] 대댓글 라우팅 (실제 댓글 171건)');
{
  const { classifyComment, checkReply } = await import(new URL('../lib/comment-harness.js', import.meta.url));
  const { pickDefaultReply } = await import(new URL('../lib/comment-style.js', import.meta.url));
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'eval', 'fixtures', 'reply-cases.json'), 'utf8'));
  let empty = 0; let broken = 0; let owner = 0; const bad = [];
  for (const c of cases) {
    const type = classifyComment(c.comment);
    if (type === 'question' || type === 'request') { owner += 1; continue; }
    const reply = pickDefaultReply(type, c.comment, [], { postTitle: c.title });
    if (!reply) { empty += 1; bad.push(`${c.id}: 빈 답글`); continue; }
    // A set reply must not trip the hard checks that would make it read like a bot or a misread.
    const hard = checkReply(reply, { commentText: c.comment, postTitle: c.title, postSnippet: c.post }).reasons
      .filter((item) => ['echo', 'misread', 'reader_voice', 'wrong_role', 'awkward', 'chatbot', 'misattribution'].includes(item.code));
    if (hard.length) { broken += 1; bad.push(`${c.id}: ${hard.map((item) => item.code).join(',')} — ${reply}`); }
  }
  record('replies', `빈 답글 없음 (${cases.length}건 중 주인에게 넘김 ${owner})`, empty === 0, bad.filter((line) => line.includes('빈 답글')).slice(0, 3).join(' / '));
  record('replies', '정해진 답글이 검사기에 걸리지 않음', broken === 0, bad.filter((line) => !line.includes('빈 답글')).slice(0, 3).join(' / '));
}

console.log('\n[3] 실제 네이버 (112, 이 코드로 비밀댓글 → 대댓글 → 확인 → 삭제)');
{
  const stamp = Date.now();
  const dir = `/tmp/nm-qa-${stamp}`;
  try {
    execFileSync('ssh', [...ssh, SERVER, `mkdir -p ${dir} && cp ~/apps/blog-engage/.playwright/naver-session.json ${dir}/session.json && ln -s ~/apps/blog-engage/node_modules ${dir}/node_modules && cp ~/apps/blog-engage/package.json ${dir}/`]);
    execFileSync('scp', [...ssh, '-q', '-r', path.join(root, 'lib'), path.join(root, 'scripts', 'qa-live.mjs'), `${SERVER}:${dir}/`]);
    const out = execFileSync('ssh', [...ssh, SERVER, `cd ${dir} && timeout 300 ${NODE} qa-live.mjs ${dir}/lib ${dir}/session.json ${QA_POST} 2>/dev/null | tail -1`], { encoding: 'utf8', timeout: 360000 });
    const live = JSON.parse(out.trim());
    for (const item of live.checks) record('live', item.name, item.ok, item.detail);
    record('live', 'QA 댓글 정리 (삭제)', live.leftovers.length === 0, live.leftovers.join(', '));
  } catch (error) {
    record('live', '실제 네이버 점검 실행', false, error.message);
  } finally {
    execFileSync('ssh', [...ssh, SERVER, `rm -rf ${dir}`]);
  }
}

const failed = results.filter((item) => !item.ok);
// Leftover QA comments are cleanup, not a broken product: warn, don't block.
const blocking = failed.filter((item) => item.name !== 'QA 댓글 정리 (삭제)');
fs.mkdirSync(path.dirname(QA_RECORD), { recursive: true });
fs.writeFileSync(QA_RECORD, `${JSON.stringify({ hash, at: new Date().toISOString(), ok: blocking.length === 0, results }, null, 2)}\n`);
console.log(blocking.length
  ? `\n❌ QA 실패 ${blocking.length}건 — 배포할 수 없습니다.`
  : `\n✅ QA 통과${failed.length ? ` (경고 ${failed.length}건: ${failed.map((item) => item.name).join(', ')})` : ''} — 이 코드는 deploy:web / release 할 수 있습니다.`);
process.exit(blocking.length ? 1 : 0);
