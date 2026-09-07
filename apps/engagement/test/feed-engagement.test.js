import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  parseFeedHtml,
  FeedEngagementHistoryStore,
  FeedEngagementManager
} from '../lib/naver-feed-engage.js';

test('parseFeedHtml extracts clean post items from HTML string and excludes blogpeople', () => {
  const mockHtml = `
    <div>
      <a href="https://m.blog.naver.com/blogpeople/12345678">네이버 공식 블로그 공지</a>
      <a href="https://m.blog.naver.com/user1/223344556677?enterPage=feed">첫번째 이웃 글</a>
      <a href="https://m.blog.naver.com/user2/998877665544">두번째 이웃 글</a>
      <a href="https://m.blog.naver.com/user1/223344556677">중복 링크</a>
    </div>
  `;

  const items = parseFeedHtml(mockHtml);
  assert.equal(items.length, 2);
  assert.equal(items[0].blogId, 'user1');
  assert.equal(items[0].logNo, '223344556677');
  assert.equal(items[0].url, 'https://m.blog.naver.com/user1/223344556677');
  assert.equal(items[1].blogId, 'user2');
  assert.equal(items[1].logNo, '998877665544');
});

test('FeedEngagementHistoryStore saves, deduplicates, and tracks daily counts', async () => {
  const testDbPath = path.join(process.cwd(), '.data', 'test-feed-history.json');
  await rm(testDbPath, { force: true }).catch(() => {});

  const store = new FeedEngagementHistoryStore(testDbPath);
  assert.equal(await store.hasEngaged('223344556677'), false);

  await store.addRecord({
    blogId: 'user1',
    logNo: '223344556677',
    author: '이웃1',
    title: '맛집 탐방 후기',
    url: 'https://m.blog.naver.com/user1/223344556677',
    liked: true,
    commented: true,
    commentText: '정말 맛있어 보이네요!'
  });

  assert.equal(await store.hasEngaged('223344556677'), true);
  assert.equal(await store.hasEngaged('https://m.blog.naver.com/user1/223344556677'), true);
  assert.equal(await store.hasEngaged('unknown_post'), false);

  const summary = await store.getSummary();
  assert.equal(summary.todayTotal, 1);
  assert.equal(summary.todayLikes, 1);
  assert.equal(summary.todayComments, 1);
  assert.equal(summary.totalRecords, 1);

  const recentComments = await store.getRecentComments(5);
  assert.deepEqual(recentComments, ['정말 맛있어 보이네요!']);

  // Reload from disk to verify persistence
  const reloaded = new FeedEngagementHistoryStore(testDbPath);
  assert.equal(await reloaded.hasEngaged('223344556677'), true);
  const reloadedSummary = await reloaded.getSummary();
  assert.equal(reloadedSummary.todayTotal, 1);

  await rm(testDbPath, { force: true }).catch(() => {});
});

test('FeedEngagementManager validates connection and executes feed engagement up to targetCount', async () => {
  const testDbPath = path.join(process.cwd(), '.data', 'test-feed-mgr.json');
  await rm(testDbPath, { force: true }).catch(() => {});
  const store = new FeedEngagementHistoryStore(testDbPath);

  // 1. Not connected validation
  const mockSession = { connected: false };
  const manager = new FeedEngagementManager({
    browserSession: mockSession,
    embeddedLlama: null,
    historyStore: store
  });

  await assert.rejects(
    async () => manager.start({ targetCount: 2 }),
    /네이버 계정이 연결되어 있지 않습니다/
  );

  // 2. Execution with mock browser session and mock posts
  const mockFeedPosts = [
    { blogId: 'friend1', logNo: '1001', author: '친구1', title: '여행기 1', url: 'https://m.blog.naver.com/friend1/1001' },
    { blogId: 'friend2', logNo: '1002', author: '친구2', title: '카페 추천', url: 'https://m.blog.naver.com/friend2/1002' },
    { blogId: 'friend3', logNo: '1003', author: '친구3', title: '책 리뷰', url: 'https://m.blog.naver.com/friend3/1003' }
  ];

  let likedAndCommentedCount = 0;
  mockSession.connected = true;
  mockSession.context = {
    async newPage() {
      return {
        async goto() {},
        async waitForTimeout() {},
        async evaluate(fn, arg) {
          if (typeof fn === 'function') {
            return mockFeedPosts;
          }
          return [];
        },
        async close() {},
        isClosed() { return false; }
      };
    }
  };

  mockSession.inspectPostForEngagement = async (url) => ({
    title: '테스트 글 제목',
    snippet: '글 본문 내용 요약...',
    images: [],
    alreadyCommented: false,
    canComment: true
  });

  mockSession.likeAndCommentPost = async ({ postUrl, commentText, doLike, doComment }) => {
    likedAndCommentedCount += 1;
    return {
      postUrl,
      liked: doLike,
      commented: doComment,
      status: 'success',
      message: '등록 완료'
    };
  };

  const mockLlama = {
    async generateBlogComment() {
      return '글 유익하게 잘 읽고 갑니다~!';
    }
  };

  const activeManager = new FeedEngagementManager({
    browserSession: mockSession,
    embeddedLlama: mockLlama,
    historyStore: store
  });

  // Target count 2 with 0s delay for testing speed
  await activeManager.start({
    targetCount: 2,
    doLike: true,
    doComment: true,
    minDelaySec: 0,
    maxDelaySec: 0
  });

  // Wait for background execution to complete
  while (activeManager.state === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.equal(activeManager.state, 'completed');
  assert.equal(activeManager.stats.successCount, 2);
  assert.equal(activeManager.stats.targetReached, true);
  assert.equal(likedAndCommentedCount, 2);

  const state = activeManager.getState();
  assert.equal(state.state, 'completed');
  assert.ok(state.logs.length > 0);
  assert.ok(state.logs.some((l) => l.message.includes('새글 소통 완료')));

  await rm(testDbPath, { force: true }).catch(() => {});
});
