import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessPosts,
  BlogActivityCache,
  classifyNeighbors,
  gradeByLastPost,
  NeighborHealthManager,
  normalizeCriteria,
  fetchAllBuddies,
  parseBuddyListHtml,
  parseMaxPage,
  parseNaverDate
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

const rows = [
  { buddyBlogNo: '1', relation: 'mutual', blogId: 'fresh', nickname: '활발이', lastPostText: '26.10.08.', addedText: '26.01.01.' },
  { buddyBlogNo: '2', relation: 'mutual', blogId: 'sleepy', nickname: '잠꾸러기', lastPostText: '26.05.01.', addedText: '26.01.01.' },
  { buddyBlogNo: '3', relation: 'mutual', blogId: 'friend', nickname: '단골', lastPostText: '26.03.01.', addedText: '26.01.01.' },
  { buddyBlogNo: '4', relation: 'oneway', blogId: 'oneway_old', nickname: '일방', lastPostText: '26.10.01.', addedText: '26.08.01.' },
  { buddyBlogNo: '5', relation: 'mutual', blogId: 'just_added', nickname: '새친구', lastPostText: '', addedText: '26.10.05.' },
  { buddyBlogNo: '6', relation: 'oneway', blogId: 'ancient', nickname: '옛날', lastPostText: '19.01.01.', addedText: '25.01.01.' }
];

test('normalizeCriteria defaults to 60 days without a new post, keeping commenters', () => {
  assert.deepEqual(normalizeCriteria({}).criteria, { activeDays: 60, relation: 'all', graceDays: 14, commentersActive: true });
  assert.equal(normalizeCriteria({ activeDays: 7, relation: 'mutual' }).criteria.relation, 'mutual');
  assert.equal(normalizeCriteria({ relation: 'oneway' }).criteria.relation, 'all');
});

test('classifyNeighbors splits active, inactive and newly added neighbors', () => {
  const protectedIds = new Set(['friend']);
  const base = classifyNeighbors(rows, normalizeCriteria({ activeDays: 30 }).criteria, { now: NOW, protectedIds });
  assert.deepEqual(base.active.map((n) => n.blogId), ['fresh', 'oneway_old', 'friend']);
  assert.equal(base.active[2].reason, '내 글에 댓글');
  assert.deepEqual(base.inactive.map((n) => n.blogId), ['ancient', 'sleepy']);
  assert.match(base.inactive[1].reason, /새 글 없음/);
  assert.equal(base.watching, 1);
  assert.equal(base.commenters, 1);

  const mutualOnly = classifyNeighbors(rows, normalizeCriteria({ activeDays: 30, relation: 'mutual' }).criteria, { now: NOW, protectedIds });
  assert.ok(mutualOnly.inactive.some((n) => n.blogId === 'oneway_old' && n.reason === '서로이웃 아님'));

  const strict = classifyNeighbors(rows, normalizeCriteria({ activeDays: 7, graceDays: 0, commentersActive: false }).criteria, { now: NOW, protectedIds });
  assert.deepEqual(strict.active.map((n) => n.blogId), ['fresh']);
  assert.deepEqual(strict.inactive.map((n) => n.blogId).sort(), ['ancient', 'friend', 'just_added', 'oneway_old', 'sleepy']);
  assert.equal(strict.watching, 0);
});

test('NeighborHealthManager reads the list once, re-filters instantly, and prunes only from the latest result', async () => {
  let reads = 0;
  const html = `<table><tbody>${row('2', 'mutual', 'sleepy', '26.05.01.', '26.01.01.')}${row('1', 'mutual', 'fresh', '26.10.08.', '26.01.01.')}</tbody></table>`;
  const fakePage = {
    goto: async () => { reads += 1; },
    waitForTimeout: async () => {},
    url: () => 'https://admin.blog.naver.com/BuddyListManage.naver',
    content: async () => html,
    evaluate: async () => 1,
    close: async () => {}
  };
  const manager = new NeighborHealthManager({
    browserSession: { connected: true, context: { newPage: async () => fakePage }, resolveMyBlogId: async () => 'me' }
  });
  await assert.rejects(() => manager.prune(['2']), /조회/);

  const first = await manager.query({ activeDays: 60 });
  assert.equal(first.result.activeCount, 1);
  assert.equal(first.result.active, undefined);
  assert.deepEqual(first.result.inactive.map((n) => n.blogId), ['sleepy']);
  const readsAfterFirst = reads;
  const second = await manager.query({ activeDays: 7 });
  assert.equal(reads, readsAfterFirst);
  assert.equal(second.result.activeCount, 1);
  assert.equal(second.result.queryId, first.result.queryId + 1);
  await assert.rejects(() => manager.prune(['1'], { queryId: second.result.queryId }), /비활성 이웃을 선택/);
  await assert.rejects(() => manager.prune(['1'], { queryId: first.result.queryId }), /다시 조회/);
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

test('fetchAllBuddies reads list pages as HTML a few at a time and keeps page order', async () => {
  const pager = (upto) => Array.from({ length: upto }, (_, i) => `<a href="#" onclick="goPage(${i + 1})">${i + 1}</a>`).join('');
  // 14 pages; the pager on page n links up to page min(n + 9, 14), like Naver's ten-page window.
  const pageHtml = (n) => `<table><tbody>${row(String(n), 'mutual', `id${n}`, '26.10.01.', '26.01.01.')}</tbody></table><div class="paginate">${pager(Math.min(n + 9, 14))}</div>`;
  let inFlight = 0;
  let peak = 0;
  const context = {
    request: {
      get: async (url) => {
        const n = Number(url.match(/currentPage=(\d+)/)[1]);
        inFlight += 1; peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        const html = n <= 14 ? pageHtml(n) : '<table><tbody></tbody></table>';
        return { url: () => url, ok: () => true, status: () => 200, headers: () => ({ 'content-type': 'text/html;charset=UTF-8' }), body: async () => Buffer.from(html) };
      }
    }
  };
  const rows = await fetchAllBuddies({ context: () => context }, 'me', { pauseMs: () => 0 });
  assert.deepEqual(rows.map((r) => r.blogId), Array.from({ length: 14 }, (_, i) => `id${i + 1}`));
  assert.equal(rows[13].sourcePage, 14);
  assert.ok(peak > 1 && peak <= 3);
  assert.equal(parseMaxPage('<a href="?currentPage=7">7</a> goPage(12)'), 12);
});
