import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlogIdList, parseBlogRss, resolveLatestPosts } from '../lib/blog-targets.js';
import { composeComment, normalizeCommentPhrases, pickCommentPhrase } from '../lib/comment-style.js';
import { validateNeighborMessage } from '../lib/comment-prompt.js';
import { returnVisitCommenter } from '../lib/return-visit.js';
import { EngagementAutomationManager } from '../lib/engagement-automation.js';

const rss = (blogId, logNo, pubDate = new Date().toUTCString()) => `<?xml version="1.0"?><rss><channel>
  <title><![CDATA[캠핑하는 하루]]></title>
  <item><author>${blogId}</author><title><![CDATA[가을 캠핑 장비 정리]]></title>
  <link><![CDATA[https://blog.naver.com/${blogId}/${logNo}?fromRss=true&trackingCode=rss]]></link>
  <description><![CDATA[<p>가을 캠핑 &amp; 난로 준비</p>]]></description><pubDate>${pubDate}</pubDate></item>
</channel></rss>`;

test('normalizeBlogIdList accepts IDs, URLs and @handles, dropping duplicates and invalid entries', () => {
  const ids = normalizeBlogIdList('alpha, https://blog.naver.com/beta/223344556677\n@gamma m.blog.naver.com/alpha bad!id PostView.naver?blogId=delta', { exclude: ['gamma'] });
  assert.deepEqual(ids, ['alpha', 'beta', 'delta']);
  assert.equal(normalizeBlogIdList(Array.from({ length: 30 }, (_, i) => `user${i}`), { limit: 5 }).length, 5);
});

test('parseBlogRss reads the newest posts with clean titles, urls and descriptions', () => {
  const [post] = parseBlogRss(rss('camper', '224400000001'), 'camper');
  assert.equal(post.blogId, 'camper');
  assert.equal(post.bloggerName, '캠핑하는 하루');
  assert.equal(post.title, '가을 캠핑 장비 정리');
  assert.equal(post.url, 'https://blog.naver.com/camper/224400000001');
  assert.equal(post.description, '가을 캠핑 & 난로 준비');
  assert.ok(post.postdate);
});

test('resolveLatestPosts skips blogs without a feed or without recent posts', async () => {
  const feeds = {
    fresh: rss('fresh', '224400000002'),
    stale: rss('stale', '224400000003', new Date(Date.now() - 40 * 86400000).toUTCString())
  };
  const fetchFn = async (url) => {
    const id = url.match(/naver\.com\/([^.]+)\.xml/)[1];
    return feeds[id] ? { ok: true, text: async () => feeds[id] } : { ok: false };
  };
  const skipped = [];
  const posts = await resolveLatestPosts(['fresh', 'stale', 'missing'], {
    activeWithinDays: 14,
    fetchFn,
    onSkip: (id, reason) => skipped.push(`${id}:${reason}`),
    nicknames: { fresh: '신선한이웃' }
  });
  assert.deepEqual(posts.map((p) => p.blogId), ['fresh']);
  assert.equal(posts[0].bloggerName, '신선한이웃');
  assert.equal(skipped.length, 2);
});

test('comment style modes: AI only, phrases only, and mixed with AI fallback to phrases', async () => {
  const phrases = normalizeCommentPhrases('{닉네임}님 글 잘 보고 갑니다!\n좋은 정보 감사해요 :)\n\nhttps://spam.example\n좋은 정보 감사해요 :)');
  assert.deepEqual(phrases, ['{닉네임}님 글 잘 보고 갑니다!', '좋은 정보 감사해요 :)']);
  assert.equal(pickCommentPhrase(phrases, { bloggerName: '하늘', random: () => 0 }), '하늘님 글 잘 보고 갑니다!');
  assert.equal(pickCommentPhrase(phrases, { bloggerName: '', random: () => 0 }), '글 잘 보고 갑니다!');

  const ai = await composeComment({ mode: 'ai', phrases, generateAi: async () => 'AI 댓글' });
  assert.deepEqual(ai, { text: 'AI 댓글', source: 'ai' });

  const fixed = await composeComment({ mode: 'phrases', phrases, generateAi: async () => { throw new Error('AI must not run'); }, random: () => 0.9 });
  assert.equal(fixed.source, 'phrase');

  const fallback = await composeComment({ mode: 'mixed', phrases, generateAi: async () => '', random: () => 0.99 });
  assert.equal(fallback.source, 'phrase');

  const recentOnly = pickCommentPhrase(['좋은 정보 감사해요 :)'], { recentComments: ['좋은 정보 감사해요 :)'] });
  assert.equal(recentOnly, '');
});

test('validateNeighborMessage keeps grounded messages and rejects promotional or off-topic ones', () => {
  const context = { title: '가을 캠핑 장비 정리', contentSnippet: '난로와 텐트 준비' };
  assert.equal(validateNeighborMessage('가을 캠핑 장비 정리해주신 글 잘 읽었어요. 앞으로 자주 소통하고 싶어요!', context).ok, true);
  assert.ok(validateNeighborMessage('캠핑 글 잘 봤어요! 맞팔 환영이고 제 블로그 방문 부탁드려요', context).reasons.includes('promotional'));
  assert.ok(validateNeighborMessage('안녕하세요 반갑습니다 서로이웃 해요 좋은 하루 보내세요', context).reasons.includes('irrelevant'));
  assert.ok(validateNeighborMessage('짧음', context).reasons.includes('length'));
});

function fakeHistory() {
  const records = [];
  return {
    records,
    async hasEngagedPost(url) { return records.some((r) => r.postUrl === url); },
    async getRecentComments() { return []; },
    async addRecord(record) { records.push(record); }
  };
}

test('returnVisitCommenter likes and comments on the newest post once, and respects daily caps', async () => {
  const historyStore = fakeHistory();
  const calls = [];
  const browserSession = {
    async inspectPostForEngagement() { return { title: '가을 캠핑', snippet: '난로 준비', canComment: true, alreadyCommented: false, images: [] }; },
    async likeAndCommentPost(args) { calls.push(args); return { liked: args.doLike, commented: args.doComment, message: '완료' }; }
  };
  const embeddedLlama = { async generateBlogComment() { return '가을 캠핑 난로 준비 글 잘 봤어요!'; } };
  const fetchLatest = async (id) => [{ blogId: id, url: `https://blog.naver.com/${id}/1`, title: '가을 캠핑' }];
  const base = { blogId: 'camper', browserSession, embeddedLlama, historyStore, fetchLatest, secret: true };

  const first = await returnVisitCommenter(base);
  assert.equal(first.status, 'visited');
  assert.equal(calls[0].secret, true);
  assert.equal(calls[0].doComment, true);
  assert.equal(historyStore.records[0].keyword, '답방');

  const again = await returnVisitCommenter(base);
  assert.equal(again.status, 'skipped');
  assert.equal(calls.length, 1);

  const capped = await returnVisitCommenter({ ...base, blogId: 'other', getTodayUsage: async () => ({ likes: 200, comments: 100 }) });
  assert.equal(capped.status, 'skipped');
  assert.match(capped.message, /일일 한도/);
});

test('engagement start validates each target source and builds an ID-list queue from RSS', async () => {
  const manager = new EngagementAutomationManager({
    browserSession: { connected: true },
    embeddedLlama: {},
    historyStore: { async getSummary() { return {}; } }
  });
  manager.runLoop = async () => {};
  await assert.rejects(() => manager.start({ targetSource: 'id_list', targetIds: '' }), /블로그 ID 목록/);
  await assert.rejects(() => manager.start({ targetSource: 'seed_commenters', seedBlogs: '!!' }), /블로그 ID나 주소/);
  await assert.rejects(() => manager.start({ keyword: '캠핑', commentMode: 'phrases', commentPhrases: '' }), /댓글 문구/);

  const status = manager.start({ targetSource: 'id_list', targetIds: 'camper\nhttps://blog.naver.com/hiker', commentMode: 'mixed', commentPhrases: '잘 보고 가요!' });
  assert.ok(status);
  assert.deepEqual(manager.config.targetIds, ['camper', 'hiker']);
  assert.deepEqual(manager.config.keywords, ['직접 입력 목록']);
  assert.equal(manager.config.neighborMessageMode, 'ai');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const id = url.match(/naver\.com\/([^.]+)\.xml/)[1];
    return { ok: true, text: async () => rss(id, '224400000009') };
  };
  try {
    const items = await manager.collectTargetPosts();
    assert.deepEqual(items.map((item) => item.blogId), ['camper', 'hiker']);
    assert.ok(items.every((item) => item.engagementTopic === '' && item.engagementKeyword === '직접 입력 목록'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
