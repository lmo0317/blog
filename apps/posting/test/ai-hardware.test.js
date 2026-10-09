import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { AgyClient, AGY_GEMINI_MODELS } from '../lib/agy-client.js';
import { ImageModelManager, IMAGE_MODEL_CATALOG } from '../lib/image-model-manager.js';
import { EngagementAutomationManager } from '../lib/engagement-automation.js';

test('AgyClient exposes Gemini models and cloud configuration', async () => {
  const agy = new AgyClient();
  const models = agy.getModels();
  assert.ok(Array.isArray(models));
  assert.equal(models.length, 3);
  assert.equal(agy.defaultModel, 'gemini-3.8-flash-high');
  assert.ok(models.some((m) => m.id === 'gemini-3.8-flash-high'));
  assert.ok(models.some((m) => m.id === 'gemini-3.7-flash-high'));
  assert.ok(models.some((m) => m.id === 'gemini-3.1-pro-high'));
});

test('ImageModelManager manages Google Imagen and cloud FLUX options', async () => {
  const testConfigPath = path.join(process.cwd(), '.data', 'test-image-config.json');
  await rm(testConfigPath, { force: true }).catch(() => {});

  const manager = new ImageModelManager({ configPath: testConfigPath });
  await manager.init();

  const list = await manager.list();
  assert.equal(list.length, 1);
  assert.equal(manager.activeModelId, 'gemini-imagen');
  assert.ok(list.some((m) => m.id === 'gemini-imagen' && m.isActive));

  await assert.rejects(() => manager.select('pollinations'));
  assert.equal(manager.activeModelId, 'gemini-imagen');

  await rm(testConfigPath, { force: true }).catch(() => {});
});

test('AgyClient builds clean human-like comment templates without local LLM', async () => {
  const agy = new AgyClient();
  const prompt = agy.buildCommentPrompt({
    title: '강남역 수플레 팬케이크 맛집 탐방',
    contentSnippet: '폭신폭신한 수플레와 딸기 토핑이 너무 맛있었습니다.',
    imageSummary: '딸기가 얹어진 수플레 팬케이크 사진',
    tone: 'friendly'
  });

  assert.ok(prompt.includes('강남역 수플레 팬케이크 맛집 탐방'));
  assert.ok(prompt.includes('폭신폭신한 수플레'));
  assert.ok(prompt.includes('자연스럽고 따뜻한 공감 댓글'));
  assert.ok(prompt.includes('친근한'));
});

test('EngagementAutomationManager validates configuration', async () => {
  const mockSession = { connected: false };
  const manager = new EngagementAutomationManager({ browserSession: mockSession, agyClient: null, historyStore: null });

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

test('EngagementAutomationManager counts completed posts once, not likes and comments separately', async () => {
  const calls = { reactions: 0, neighbors: 0, searchDisplay: 0 };
  const posts = Array.from({ length: 5 }, (_value, index) => ({
    blogId: `blog${index}`,
    title: `테스트 글 ${index}`,
    url: `https://blog.naver.com/blog${index}/${1000 + index}`
  }));
  const mockSession = {
    connected: true,
    async searchBlogs({ display }) { calls.searchDisplay = display; return posts; },
    async inspectPostForEngagement() { return { title: '테스트 글', snippet: '', images: [] }; },
    async likeAndCommentPost() { calls.reactions += 1; return { liked: true, commented: true, message: '완료' }; },
    async addNeighbor() { calls.neighbors += 1; return { status: 'requested', message: '완료' }; }
  };
  const mockHistory = {
    async getEngagedBlogIds() { return []; },
    async hasEngagedPost() { return false; },
    async addRecord() {}
  };
  const mockAgy = { async generateBlogComment() { return '좋은 글 감사합니다.'; } };
  const manager = new EngagementAutomationManager({ browserSession: mockSession, agyClient: mockAgy, historyStore: mockHistory });
  manager.countdownDelay = async () => {};

  await manager.start({ keyword: '테스트', targetCount: 3, doLike: true, doComment: true, doNeighbor: true, minDelay: 5, maxDelay: 5 });
  while (manager.state === 'running') await new Promise((resolve) => setTimeout(resolve, 1));

  assert.equal(calls.searchDisplay, 100);
  assert.equal(manager.stats.processedCount, 3);
  assert.equal(manager.stats.likeSuccessCount, 3);
  assert.equal(manager.stats.commentSuccessCount, 3);
  assert.equal(manager.stats.neighborSuccessCount, 3);
  assert.equal(calls.reactions, 3);
  assert.equal(calls.neighbors, 3);
  assert.equal(manager.stats.targetReached, true);
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
  assert.equal(await store.hasEngagedPost('https://m.blog.naver.com/otheruser/99999999', 'otheruser'), false);

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
    badge: '💎 Google Gemini AI 인포그래픽',
    title: '성공적인 블로그 운영 핵심 가이드',
    subtitle: '클라우드 연산으로 완성하는 고화질 비주얼 콘텐츠',
    items: [
      { title: '핵심 1', desc: '고품질 글과 이미지의 완벽한 조화' },
      { title: '핵심 2', desc: '독자의 시선을 사로잡는 인포그래픽' }
    ],
    highlight: 'Google Gemini가 직접 디자인한 인포그래픽입니다.',
    theme: 'indigo'
  });

  assert.ok(html.includes('1200px'));
  assert.ok(html.includes('800px'));
  assert.ok(html.includes('성공적인 블로그 운영 핵심 가이드'));
  assert.ok(html.includes('Google Gemini AI Studio'));
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
