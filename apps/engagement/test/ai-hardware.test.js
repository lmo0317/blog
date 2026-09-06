import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { detectGpuSpecs, getSystemHardwareSummary, MODEL_CATALOG } from '../lib/hardware.js';
import { ModelManager } from '../lib/model-manager.js';
import { EmbeddedLlamaServer, normalizeCommentText, validateBlogComment } from '../lib/embedded-llama.js';
import { EngagementAutomationManager, ENGAGEMENT_LIMITS, buildNeighborMessage, selectPostActions } from '../lib/engagement-automation.js';
import { normalizeAutocompleteKeywords, recommendKeywordsFromTexts } from '../lib/naver.js';

test('detectGpuSpecs and getSystemHardwareSummary return valid system metrics and model recommendations', async () => {
  const summary = await getSystemHardwareSummary();
  assert.ok(summary.cpu.model);
  assert.ok(summary.cpu.cores > 0);
  assert.ok(summary.ram.totalGb > 0);
  assert.ok(summary.recommendedModel.id in MODEL_CATALOG);
  assert.ok(Array.isArray(summary.catalog));
  assert.equal(summary.catalog.length, 3);
});

test('ModelManager handles local models catalog and active model selection', async () => {
  const testModelsDir = path.join(process.cwd(), '.models-test');
  const testConfigPath = path.join(process.cwd(), '.data', 'test-ai-config.json');
  await rm(testModelsDir, { recursive: true, force: true }).catch(() => {});
  await rm(testConfigPath, { force: true }).catch(() => {});

  const manager = new ModelManager(testModelsDir, testConfigPath);
  await manager.init();

  const installed = await manager.getInstalledModels();
  assert.equal(installed.length, 3);
  assert.equal(installed.every((m) => m.isInstalled === false), true);

  await rm(testModelsDir, { recursive: true, force: true }).catch(() => {});
  await rm(testConfigPath, { force: true }).catch(() => {});
});

test('EmbeddedLlamaServer generates clean human-like comment templates', async () => {
  const server = new EmbeddedLlamaServer({ modelManager: null, fallbackExternalUrl: '' });
  const comment = await server.generateBlogComment({
    title: '강남역 수플레 팬케이크 맛집 탐방',
    contentSnippet: '폭신폭신한 수플레와 딸기 토핑이 너무 맛있었습니다.',
    tone: 'friendly'
  });

  assert.ok(comment.length > 5);
  assert.equal(server.cleanCommentOutput('"정말 맛있는 후기네요!"'), '정말 맛있는 후기네요!');
  assert.equal(server.cleanCommentOutput('댓글 : 유익한 정보 감사합니다.'), '유익한 정보 감사합니다.');
});

test('comment harness rejects irrelevant, duplicated, noisy, and prompt-artifact output', () => {
  const context = { title: '강남역 수플레 팬케이크 맛집', contentSnippet: '딸기 토핑과 폭신한 수플레를 주문했습니다.' };
  assert.equal(validateBlogComment('제주 바다가 정말 아름답고 멋지네요!', context).ok, false);
  assert.ok(validateBlogComment('딸기 토핑이 올라간 수플레 설명이 특히 인상적이었어요.', context).ok);
  assert.equal(validateBlogComment('딸기 토핑이 올라간 수플레 설명이 특히 인상적이었어요!', context, ['딸기 토핑이 올라간 수플레 설명이 특히 인상적이었어요.']).ok, false);
  assert.equal(validateBlogComment('assistant: 딸기 수플레!!!! \uFFFD', context).ok, false);
  assert.equal(normalizeCommentText('댓글 : \u200b딸기 수플레 후기 잘 봤어요.\uFFFD'), '딸기 수플레 후기 잘 봤어요.');
});

test('EngagementAutomationManager validates configuration', async () => {
  const mockSession = { connected: false };
  const manager = new EngagementAutomationManager({ browserSession: mockSession, embeddedLlama: null, historyStore: null });

  await assert.rejects(
    async () => manager.start({ keyword: '맛집' }),
    /네이버 계정이 연결되어 있지 않습니다/
  );

  mockSession.connected = true;

  await assert.rejects(
    async () => manager.start({ keyword: '' }),
    /검색 키워드를 입력해주세요/
  );
});

test('EngagementAutomationManager caps the overall target at 100 posts', async () => {
  let requestedDisplay = 0;
  const manager = new EngagementAutomationManager({
    browserSession: { connected: true, async searchBlogs({ display }) { requestedDisplay = display; return []; } },
    embeddedLlama: null,
    historyStore: null
  });
  await manager.start({ keyword: '육아', targetCount: 500, doLike: true, doComment: false, doNeighbor: false });
  while (manager.state === 'running') await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(manager.config.targetCount, 100);
  assert.equal(manager.stats.targetCount, 100);
  assert.equal(requestedDisplay, 200);
});

test('engagement campaign caps the total target and daily neighbor ceiling at 100', async () => {
  const manager = new EngagementAutomationManager({
    browserSession: { connected: true, async searchBlogs() { return []; } },
    embeddedLlama: null,
    historyStore: null
  });
  await manager.start({
    keyword: '육아', targetCount: 300, dailyNeighborLimit: 300,
    minDelay: 120, maxDelay: 180, sessionPosts: 10,
    sessionBreakMinSeconds: 600, sessionBreakMaxSeconds: 1200
  });
  while (manager.state === 'running') await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(manager.config.targetCount, 100);
  assert.equal(manager.config.dailyNeighborLimit, 100);
  assert.equal(manager.config.minDelay, 120);
  assert.equal(manager.config.maxDelay, 180);
  assert.equal(manager.config.sessionPosts, 10);
  assert.equal(manager.config.sessionBreakMinSeconds, 600);
  assert.equal(manager.config.sessionBreakMaxSeconds, 1200);

  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="engTargetCount"[^>]*max="100"[^>]*value="100"/);
  assert.match(html, /id="engDailyNeighborLimit"[^>]*max="100"/);
  assert.match(html, /id="engNeighborUsed"/);
  assert.match(html, /id="engNeighborRemaining"/);
  assert.match(html, /id="engNeighborResetAt"/);
  assert.match(html, /id="engSessionPosts"/);
  assert.match(html, /id="engBreakMinMinutes"/);
  assert.match(html, /보호조치 경고/);
});

test('multi-keyword harness treats the target as an overall total', async () => {
  const searched = [];
  let reactions = 0;
  const session = { connected: true, async searchBlogs({ query }) { searched.push(query); return Array.from({ length: 4 }, (_, i) => ({ blogId: `${query}${i}`, title: `${query} 글 ${i}`, url: `https://blog.naver.com/${query}${i}/${10000000 + i}` })); }, async inspectPostForEngagement(postUrl) { return { title: postUrl, snippet: '본문', images: [] }; }, async likeAndCommentPost() { reactions += 1; return { liked: true, commented: false, message: '완료' }; } };
  const history = { async hasEngagedPost() { return false; }, async addRecord() {} };
  const manager = new EngagementAutomationManager({ browserSession: session, embeddedLlama: null, historyStore: history });
  manager.countdownDelay = async () => {};
  await manager.start({ keyword: '육아, 쇼핑, 건강', targetCount: 2, doComment: false, doNeighbor: false, minDelay: 5, maxDelay: 5 });
  while (manager.state === 'running') await new Promise((resolve) => setTimeout(resolve, 1));
  assert.deepEqual(searched, ['육아', '쇼핑', '건강']);
  assert.equal(manager.config.targetPerKeyword, 1);
  assert.equal(manager.stats.targetCount, 2);
  assert.equal(reactions, 2);
  assert.deepEqual(manager.stats.keywordProcessedCounts, { 육아: 1, 쇼핑: 1, 건강: 0 });
});

test('blog-style keyword analyzer ranks recurring categories', () => {
  assert.deepEqual(recommendKeywordsFromTexts(['아이와 육아 일상 및 키즈 교육', '아기 건강 식단', '육아용품 쇼핑 제품 리뷰'], 3), ['육아', '쇼핑', '건강']);
});

test('Naver autocomplete payload becomes a clean unique related-keyword list', () => {
  const payload = { items: [[['캠핑용품', '0'], ['캠핑', '0'], ['캠핑 음식', '0'], ['캠핑용품', '0']]] };
  assert.deepEqual(normalizeAutocompleteKeywords(payload, '캠핑'), ['캠핑용품', '캠핑 음식']);
});

test('EngagementAutomationManager counts completed posts once, not likes and comments separately', async () => {
  const calls = { reactions: 0, neighbors: 0, searchDisplay: 0 };
  const daily = { likes: 0, comments: 0, neighbors: 0 };
  const posts = Array.from({ length: 5 }, (_value, index) => ({
    blogId: `blog${index}`,
    title: `테스트 글 ${index}`,
    url: `https://blog.naver.com/blog${index}/${1000 + index}`
  }));
  const mockSession = {
    connected: true,
    async searchBlogs({ display }) { calls.searchDisplay = display; return posts; },
    async inspectPostForEngagement() { return { title: '테스트 글', snippet: '', images: [] }; },
    async likeAndCommentPost({ doLike, doComment }) { calls.reactions += 1; return { liked: doLike, commented: doComment, message: '완료' }; },
    async addNeighbor() { calls.neighbors += 1; return { status: 'requested', message: '완료' }; }
  };
  const mockHistory = {
    async getEngagedBlogIds() { return []; },
    async hasEngagedPost() { return false; },
    async getSummary() { return { todayLikes: daily.likes, todayComments: daily.comments, todayNeighbors: daily.neighbors }; },
    async addRecord(record) {
      if (record.liked) daily.likes += 1;
      if (record.commented) daily.comments += 1;
      if (record.neighborRequested) daily.neighbors += 1;
    }
  };
  const mockLlm = { async generateBlogComment() { return '좋은 글 감사합니다.'; } };
  const manager = new EngagementAutomationManager({ browserSession: mockSession, embeddedLlama: mockLlm, historyStore: mockHistory });
  manager.countdownDelay = async () => {};

  await manager.start({ keyword: '테스트', targetCount: 3, doLike: true, doComment: true, doNeighbor: true, minDelay: 5, maxDelay: 5 });
  while (manager.state === 'running') await new Promise((resolve) => setTimeout(resolve, 1));

  assert.equal(calls.searchDisplay, 100);
  assert.equal(manager.stats.processedCount, 3);
  assert.equal(manager.stats.likeSuccessCount + manager.stats.commentSuccessCount + manager.stats.neighborSuccessCount, 6);
  assert.equal(calls.reactions, 3);
  assert.ok(calls.neighbors < 3);
  assert.equal(manager.stats.targetReached, true);
});

test('EngagementAutomationManager preflights and skips pending neighbor requests', async () => {
  let addCalls = 0;
  const session = {
    connected: true,
    async searchBlogs() { return [{ blogId: 'pending-blog', title: '대기 중인 블로그', url: 'https://blog.naver.com/pending-blog/12345678' }]; },
    async inspectNeighborRelationship() { return { status: 'requested', message: '이미 서로이웃 신청 중입니다.', rawMessage: '서로이웃 신청 진행 중입니다.' }; },
    async addNeighbor() { addCalls += 1; return { status: 'requested', message: '완료' }; }
  };
  const history = {
    async hasEngagedPost() { return false; },
    async getNeighborRelationship() { return null; },
    async getSummary() { return { todayLikes: 0, todayComments: 0, todayNeighbors: 0 }; }
  };
  const manager = new EngagementAutomationManager({ browserSession: session, embeddedLlama: null, historyStore: history });
  await manager.start({ keyword: '육아', targetCount: 1, doLike: false, doComment: false, doNeighbor: true });
  while (manager.state === 'running') await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(addCalls, 0);
  assert.equal(manager.stats.processedCount, 0);
  assert.ok(manager.logs.some((entry) => entry.message.includes('[이웃 사전 제외]')));
});

test('EngagementAutomationManager excludes a blog with a prior neighbor-request record', async () => {
  let inspectCalls = 0;
  let addCalls = 0;
  const session = {
    connected: true,
    async searchBlogs() { return [{ blogId: 'known-blog', title: '기존 이웃 신청', url: 'https://blog.naver.com/known-blog/12345678' }]; },
    async inspectNeighborRelationship() { inspectCalls += 1; return { status: 'eligible' }; },
    async addNeighbor() { addCalls += 1; return { status: 'requested' }; }
  };
  const history = {
    async hasEngagedPost() { return false; },
    async getNeighborRelationship() { return { neighborStatus: 'requested', statusMessage: '서로이웃 신청 완료' }; },
    async getSummary() { return { todayLikes: 0, todayComments: 0, todayNeighbors: 1 }; }
  };
  const manager = new EngagementAutomationManager({ browserSession: session, embeddedLlama: null, historyStore: history });
  await manager.start({ keyword: '육아', targetCount: 1, doLike: false, doComment: false, doNeighbor: true });
  while (manager.state === 'running') await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(inspectCalls, 0);
  assert.equal(addCalls, 0);
  assert.ok(manager.logs.some((entry) => entry.message.includes('[이웃 이력 제외]')));
});

test('engagement safety policy enforces daily limits and at most two actions per post', () => {
  const actions = selectPostActions({
    requested: { like: true, comment: true, neighbor: true },
    todayCounts: { likes: ENGAGEMENT_LIMITS.likesPerDay, comments: 12, neighbors: 4 },
    postIndex: 1
  });
  assert.deepEqual(actions.sort(), ['comment', 'neighbor']);
  assert.equal(actions.length, 2);
  assert.deepEqual(selectPostActions({
    requested: { like: true, comment: true, neighbor: true },
    todayCounts: { likes: 200, comments: 100, neighbors: 100 }
  }), []);
});

test('neighbor messages vary while retaining the configured message', () => {
  const messages = Array.from({ length: 4 }, (_, index) => buildNeighborMessage('좋은 이웃으로 소통해요.', '봄이', '육아', index));
  assert.equal(new Set(messages).size, 4);
  assert.ok(messages.every((message) => message.includes('좋은 이웃으로 소통해요.')));
});

test('EngagementHistoryStore stores records, prevents duplicates, and exports CSV', async () => {
  const { EngagementHistoryStore } = await import('../lib/history.js');
  const testStorePath = path.join(process.cwd(), '.data', 'test-engagement-history.json');
  await rm(testStorePath, { force: true }).catch(() => {});

  const store = new EngagementHistoryStore(testStorePath);
  await store.load();

  assert.equal(await store.hasEngagedPost('https://m.blog.naver.com/testuser/12345678', 'testuser'), false);

  await store.addRecord({
    blogId: 'testuser',
    bloggerName: '테스트유저',
    title: '맛있는 음식 후기',
    postUrl: 'https://m.blog.naver.com/testuser/12345678',
    keyword: '맛집',
    liked: true,
    commented: true,
    commentText: '정말 유익한 맛집 글이네요!',
    neighborRequested: true,
    neighborStatus: 'requested',
    neighborMessage: '서로이웃 맺고 소통해요',
    status: 'success',
    statusMessage: '공감(❤️), 댓글 작성 및 서로이웃 신청 완료'
  });

  assert.equal(await store.hasEngagedPost('https://blog.naver.com/testuser/12345678', 'testuser'), true);
  assert.equal(await store.hasEngagedPost('https://blog.naver.com/testuser/87654321', 'testuser'), false);
  assert.equal(await store.hasEngagedPost('https://blog.naver.com/PostView.naver?blogId=testuser&logNo=12345678', ''), true);
  assert.equal(await store.hasEngagedPost('https://m.blog.naver.com/otheruser/99999999', 'otheruser'), false);
  assert.equal((await store.getNeighborRelationship('testuser'))?.neighborStatus, 'requested');

  const engagedIds = await store.getEngagedBlogIds();
  assert.ok(engagedIds.includes('testuser'));

  const summary = await store.getSummary();
  assert.equal(summary.totalLikes, 1);
  assert.equal(summary.totalComments, 1);
  assert.equal(summary.totalNeighbors, 1);

  const csv = await store.exportCsv();
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('testuser'));
  assert.ok(csv.includes('신청완료'));
  assert.ok(csv.includes('정말 유익한 맛집 글이네요!'));

  await rm(testStorePath, { force: true }).catch(() => {});
});

test('extractArticleContent parses raw text and mock HTML correctly', async () => {
  const { extractArticleContent } = await import('../lib/article-scraper.js');

  // Test raw text
  const rawResult = await extractArticleContent('제목: 인공지능 최신 트렌드\n인공지능 기술이 발전함에 따라 다양한 혁신이 일어나고 있습니다.');
  assert.equal(rawResult.title, '제목: 인공지능 최신 트렌드');
  assert.ok(rawResult.content.includes('인공지능 기술이 발전함에'));

  // Test HTML scraping mock
  const mockFetch = async () => ({
    ok: true,
    text: async () => `
      <html>
        <head><title>네이버 뉴스 - 2026 AI 신기술 발표</title></head>
        <body><article><p>2026년 최신 인공지능 모델이 공개되어 화제가 되고 있습니다.</p></article></body>
      </html>
    `
  });

  const urlResult = await extractArticleContent('https://news.naver.com/article/123', { fetchImpl: mockFetch });
  assert.ok(urlResult.title.includes('2026 AI 신기술 발표'));
  assert.ok(urlResult.content.includes('2026년 최신 인공지능 모델이 공개'));
});

test('visual-renderer generates valid 1200x800 card HTML and structure', async () => {
  const { generateCardHtml } = await import('../lib/visual-renderer.js');
  const html = generateCardHtml({
    type: 'summary_card',
    badge: '⚡ Gemma 4 12B AI 인포그래픽',
    title: '성공적인 블로그 운영 핵심 가이드',
    subtitle: '100% 로컬 연산으로 완성하는 비주얼 콘텐츠',
    items: [
      { title: '핵심 1', desc: '고품질 글과 이미지의 완벽한 조화' },
      { title: '핵심 2', desc: '독자의 시선을 사로잡는 인포그래픽' }
    ],
    highlight: 'Gemma 4 12B가 직접 디자인한 인포그래픽입니다.',
    theme: 'indigo'
  });

  assert.ok(html.includes('1200px'));
  assert.ok(html.includes('800px'));
  assert.ok(html.includes('성공적인 블로그 운영 핵심 가이드'));
  assert.ok(html.includes('Gemma 4 12B Local AI Studio'));
});

test('ai-image-generator builds rich artistic prompts for multiple styles', async () => {
  const { buildEnhancedImagePrompt, AI_IMAGE_STYLES } = await import('../lib/ai-image-generator.js');

  const photoPrompt = buildEnhancedImagePrompt('cozy coffee shop table', 'photorealistic');
  assert.ok(photoPrompt.includes('coffee'));
  assert.ok(photoPrompt.includes('photorealistic'));

  const cartoonPrompt = buildEnhancedImagePrompt('happy puppy in park', 'cartoon_3d');
  assert.ok(cartoonPrompt.includes('Pixar'));

  const animePrompt = buildEnhancedImagePrompt('sunset mountain view', 'anime_webtoon');
  assert.ok(animePrompt.includes('Makoto Shinkai'));
});
