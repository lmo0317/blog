import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessPosts,
  BlogActivityCache,
  gradeByLastPost,
  gradeNeighbors,
  parseBuddyListHtml,
  parseNaverDate,
  summarizeNeighbors
} from '../lib/neighbor-health.js';
import { returnVisitCommenter } from '../lib/return-visit.js';
import { NeighborCleanerManager } from '../lib/naver-neighbor-cleaner.js';

const NOW = new Date(2026, 9, 9, 12, 0, 0); // 2026-10-09 local
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);
const row = (no, type, blogId, lastPost, added) => `<tr><td class="checkwrap"><input type="checkbox" class="list_checkbox" name="buddyBlogNo" value="${no}" alt="4"></td>
  <td class="groupwrap"><div class="ellipsis1">소통이웃-2</div></td>
  <td class="type"><span class="${type === 'mutual' ? 'both' : 'buddy'}">${type === 'mutual' ? '서로이웃' : '이웃'}</span></td>
  <td class="buddy"><div class="ellipsis2"><span class="nickname">닉_${blogId}</span><span class="bar">|</span><a href="https://blog.naver.com/${blogId}" target="_blank">블로그</a></div></td>
  <td><a href="#" class="alert on ${no} _returnFalse"><span class="blind">ON</span></a></td><td>${lastPost}</td><td>${added}</td></tr>`;

test('parseBuddyListHtml reads the real neighbor-list row layout', () => {
  const html = `<table><thead><tr><th>이웃</th></tr></thead><tbody>${row('61636084', 'mutual', 'victorious_s', '26.10.09.', '26.10.09.')}${row('253331', 'oneway', 'itexpert', '26.07.01.', '26.09.01.')}</tbody></table>`;
  const rows = parseBuddyListHtml(html);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { no: rows[0].buddyBlogNo, relation: rows[0].relation, blogId: rows[0].blogId, nick: rows[0].nickname, last: rows[0].lastPostText, added: rows[0].addedText, group: rows[0].group },
    { no: '61636084', relation: 'mutual', blogId: 'victorious_s', nick: '닉_victorious_s', last: '26.10.09.', added: '26.10.09.', group: '소통이웃-2' }
  );
  assert.equal(rows[1].relation, 'oneway');
});

test('dates and activity grades', () => {
  assert.equal(parseNaverDate('26.10.09.', NOW).getDate(), 9);
  assert.equal(parseNaverDate('13:20', NOW).getDate(), 9);
  assert.equal(parseNaverDate('', NOW), null);
  assert.equal(gradeByLastPost(daysAgo(3), { now: NOW }), 'active');
  assert.equal(gradeByLastPost(daysAgo(30), { now: NOW }), 'slow');
  assert.equal(gradeByLastPost(daysAgo(90), { now: NOW }), 'dormant');
  assert.equal(gradeByLastPost(null, { now: NOW }), 'dormant');
});

test('gradeNeighbors picks dormant prune candidates but protects commenters and new neighbors', () => {
  const rows = [
    { buddyBlogNo: '1', relation: 'mutual', blogId: 'fresh', lastPostText: '26.10.08.', addedText: '26.01.01.' },
    { buddyBlogNo: '2', relation: 'mutual', blogId: 'sleepy', lastPostText: '26.05.01.', addedText: '26.01.01.' },
    { buddyBlogNo: '3', relation: 'mutual', blogId: 'friend', lastPostText: '26.03.01.', addedText: '26.01.01.' },
    { buddyBlogNo: '4', relation: 'oneway', blogId: 'oneway_old', lastPostText: '26.10.01.', addedText: '26.08.01.' },
    { buddyBlogNo: '5', relation: 'mutual', blogId: 'just_added', lastPostText: '', addedText: '26.10.05.' }
  ];
  const graded = gradeNeighbors(rows, { now: NOW, protectedIds: new Set(['friend']) });
  const byId = Object.fromEntries(graded.map((n) => [n.blogId, n]));
  assert.equal(byId.fresh.pruneCandidate, false);
  assert.equal(byId.sleepy.pruneCandidate, true);
  assert.match(byId.sleepy.pruneReason, /새 글 없음/);
  assert.equal(byId.friend.pruneCandidate, false);
  assert.equal(byId.friend.protected, true);
  assert.equal(byId.oneway_old.pruneCandidate, false);
  assert.equal(byId.just_added.pruneCandidate, false);

  const withOneway = gradeNeighbors(rows, { now: NOW, includeOneway: true });
  assert.equal(withOneway.find((n) => n.blogId === 'oneway_old').pruneCandidate, true);

  const summary = summarizeNeighbors(graded);
  assert.deepEqual({ total: summary.total, active: summary.active, dormant: summary.dormant, candidates: summary.candidates }, { total: 5, active: 2, dormant: 3, candidates: 1 });
});

test('assessPosts separates active, dormant and ad/bot blogs from RSS posts', () => {
  const post = (days, title = '오늘 캠핑 다녀온 이야기') => ({ title, description: '', postdate: daysAgo(days).toISOString() });
  assert.equal(assessPosts([post(2), post(10), post(20)], { now: NOW }).grade, 'active');
  assert.equal(assessPosts([post(100)], { now: NOW }).grade, 'dormant');
  assert.equal(assessPosts([], { now: NOW }).grade, 'unknown');
  const ads = [post(1, '[체험단] 크림 후기'), post(2, '협찬 받은 청소기'), post(3, '원고료를 받아 작성'), post(4, '일상')];
  assert.equal(assessPosts(ads, { now: NOW }).grade, 'spam');
  const bot = Array.from({ length: 12 }, () => post(1));
  assert.equal(assessPosts(bot, { now: NOW }).grade, 'spam');
});

test('BlogActivityCache fetches a blog once within the cache period', async () => {
  let calls = 0;
  const cache = new BlogActivityCache('', { fetchLatest: async () => { calls += 1; return [{ title: '글', postdate: new Date().toISOString() }]; } });
  assert.equal((await cache.assess('camper')).grade, 'active');
  await cache.assess('Camper');
  assert.equal(calls, 1);
});

test('return visits skip dormant or ad blogs before opening any page', async () => {
  let inspected = false;
  const result = await returnVisitCommenter({
    blogId: 'sleepy',
    browserSession: { async inspectPostForEngagement() { inspected = true; return {}; } },
    embeddedLlama: {},
    historyStore: { async hasEngagedPost() { return false; } },
    assessActivity: async () => ({ grade: 'dormant', reason: '마지막 글이 120일 전입니다.' })
  });
  assert.equal(result.status, 'skipped');
  assert.match(result.message, /광고성|활동/);
  assert.equal(inspected, false);
});

test('received-request screening rejects ad blogs and holds dormant ones (dry run)', async () => {
  const request = (id) => `<tr><td><input type="checkbox" name="targetBlogId" value="${id}"></td><td><span class="nickname">${id}</span></td><td class="msg">안녕하세요 캠핑 글 잘 보고 있어요 서로이웃 해요</td><td class="date">26.10.09.</td></tr>`;
  const html = `<table>${request('adblog')}${request('sleepy')}${request('good')}</table>`;
  const fakePage = { goto: async () => {}, waitForTimeout: async () => {}, content: async () => html, close: async () => {} };
  const manager = new NeighborCleanerManager({
    browserSession: { connected: true, context: { newPage: async () => fakePage }, resolveMyBlogId: async () => 'me' },
    embeddedLlama: null,
    assessActivity: async (id) => ({ grade: id === 'adblog' ? 'spam' : id === 'sleepy' ? 'dormant' : 'active', reason: 'test' })
  });
  const result = await manager.startCleanReceived({ dryRun: true });
  assert.deepEqual({ accepted: result.stats.accepted, rejected: result.stats.rejected, skipped: result.stats.skipped }, { accepted: 1, rejected: 1, skipped: 1 });
});
