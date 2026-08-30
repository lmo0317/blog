import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { detectGpuSpecs, getSystemHardwareSummary, MODEL_CATALOG } from '../lib/hardware.js';
import { ModelManager } from '../lib/model-manager.js';
import { EmbeddedLlamaServer } from '../lib/embedded-llama.js';
import { EngagementAutomationManager } from '../lib/engagement-automation.js';

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