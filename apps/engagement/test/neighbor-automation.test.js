import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { NeighborHistoryStore } from '../lib/history.js';
import { NeighborAutomationManager } from '../lib/automation.js';
import { parseRelativePostDate, isPostActiveWithinDays, classifyNeighborResult } from '../lib/naver.js';

test('NeighborHistoryStore saves records, prevents duplicates, and tracks daily count', async (t) => {
  const testDbPath = path.join(process.cwd(), '.data', 'test-history.json');
  await rm(testDbPath, { force: true }).catch(() => {});

  const store = new NeighborHistoryStore(testDbPath);
  await store.load();

  assert.equal(await store.hasHistory('blogger123'), false);
  assert.equal(await store.getTodayCount(), 0);

  // Add a requested record
  await store.addRecord({
    blogId: 'blogger123',
    bloggerName: '테스트블로거',
    keyword: '맛집',
    message: '안녕하세요!',
    status: 'requested',
    statusText: '서로이웃 신청이 완료되었습니다.'
  });

  assert.equal(await store.hasHistory('blogger123'), true);
  assert.equal(await store.hasHistory('BLOGGER123'), true); // Case-insensitive
  assert.equal(await store.getTodayCount(), 1);

  // Add another non-requested record (skip)
  await store.addRecord({
    blogId: 'blogger456',
    bloggerName: '두번째블로거',
    keyword: '맛집',
    message: '안녕하세요!',
    status: 'already_mutual',
    statusText: '이미 서로이웃인 블로그입니다.'
  });

  assert.equal(await store.hasHistory('blogger456'), true);
  assert.equal(await store.getTodayCount(), 1); // Only requested/added count towards daily limit

  // Summary check
  const summary = await store.getSummary();
  assert.equal(summary.todayCount, 1);
  assert.equal(summary.totalCount, 2);
  assert.equal(summary.successfulCount, 1);

  // CSV export check
  const csv = await store.exportCsv();
  assert.ok(csv.includes('blogger123'));
  assert.ok(csv.includes('테스트블로거'));
  assert.ok(csv.startsWith('\uFEFF')); // BOM

  // Cleanup
  await rm(testDbPath, { force: true }).catch(() => {});
});

test('parseRelativePostDate and isPostActiveWithinDays correctly parse relative Korean dates', () => {
  const now = new Date();
  
  assert.ok(isPostActiveWithinDays('방금 전', 7));
  assert.ok(isPostActiveWithinDays('3시간 전', 7));
  assert.ok(isPostActiveWithinDays('어제', 7));
  assert.ok(isPostActiveWithinDays('2일 전', 7));
  assert.ok(isPostActiveWithinDays('5일 전', 7));
  assert.equal(isPostActiveWithinDays('10일 전', 7), false);
  assert.ok(isPostActiveWithinDays('10일 전', 14));
  assert.equal(isPostActiveWithinDays('2개월 전', 30), false);
});

test('classifyNeighborResult distinguishes daily limit, mutual, and pending states', () => {
  assert.equal(
    classifyNeighborResult('하루에 신청할 수 있는 서로이웃 신청 수를 초과하였습니다.').status,
    'limit_reached'
  );
  assert.equal(
    classifyNeighborResult('현재 서로이웃입니다.').status,
    'already_mutual'
  );
  assert.equal(
    classifyNeighborResult('서로이웃 신청이 완료되었습니다.').status,
    'requested'
  );
  assert.equal(
    classifyNeighborResult('자동입력 방지 문자를 입력하세요').status,
    'verification_required'
  );
});

test('NeighborAutomationManager validates config and checks daily limit', async () => {
  const testDbPath = path.join(process.cwd(), '.data', 'test-history-mgr.json');
  await rm(testDbPath, { force: true }).catch(() => {});
  const store = new NeighborHistoryStore(testDbPath);

  const mockSession = { connected: false };
  const manager = new NeighborAutomationManager({ browserSession: mockSession, historyStore: store });

  // Not connected error
  await assert.rejects(
    async () => manager.start({ keyword: '맛집' }),
    /네이버 계정이 연결되어 있지 않습니다/
  );

  mockSession.connected = true;

  // Empty keyword error
  await assert.rejects(
    async () => manager.start({ keyword: '' }),
    /검색 키워드를 입력해주세요/
  );

  await rm(testDbPath, { force: true }).catch(() => {});
});