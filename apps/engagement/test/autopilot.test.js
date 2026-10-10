import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  AutopilotManager,
  isWithinActiveHours,
  msUntilActive,
  normalizeAutopilotSettings,
  pickGoldenKeyword
} from '../lib/autopilot.js';

// 2026-10-09 12:00 KST
const NOON_KST = new Date('2026-10-09T03:00:00Z');

test('normalizeAutopilotSettings clamps numbers and dedupes topics', () => {
  const settings = normalizeAutopilotSettings({ seedTopics: '캠핑, 캠핑,\n여행', postsPerCycle: 999, intervalMinutes: 5, steps: { feed: false } });
  assert.equal(settings.seedTopics, '캠핑, 여행');
  assert.equal(settings.postsPerCycle, 50);
  assert.equal(settings.intervalMinutes, 30);
  assert.equal(settings.steps.feed, false);
  assert.equal(settings.steps.engage, true);
});

test('active hours use Korean time and support windows that pass midnight', () => {
  assert.equal(isWithinActiveHours(NOON_KST, 9, 23), true);
  assert.equal(isWithinActiveHours(NOON_KST, 13, 23), false);
  assert.equal(isWithinActiveHours(new Date('2026-10-09T16:30:00Z'), 21, 2), true); // 01:30 KST
  assert.equal(msUntilActive(NOON_KST, 13, 23), 60 * 60 * 1000);
});

test('pickGoldenKeyword prefers S/A grades and skips keywords used this week', () => {
  const items = [
    { keyword: '캠핑 난로', grade: 'S' },
    { keyword: '캠핑 의자', grade: 'A' },
    { keyword: '캠핑 텐트', grade: 'B' }
  ];
  const now = NOON_KST.getTime();
  assert.equal(pickGoldenKeyword(items, { now }).keyword, '캠핑 난로');
  const used = { '캠핑 난로': new Date(now - 86400000).toISOString(), '캠핑 의자': new Date(now - 8 * 86400000).toISOString() };
  assert.equal(pickGoldenKeyword(items, { usedKeywords: used, now }).keyword, '캠핑 의자');
  assert.equal(pickGoldenKeyword([items[2]], { now }), null);
  assert.equal(pickGoldenKeyword([items[2]], { allowGradeB: true, now }).keyword, '캠핑 텐트');
});

function makeManager(overrides = {}) {
  const calls = [];
  const statePath = path.join(os.tmpdir(), `autopilot-test-${Date.now()}-${Math.random()}.json`);
  let manager;
  const waits = [];
  const steps = {
    acceptNeighbors: async () => { calls.push('acceptNeighbors'); return { summary: '수락 1건' }; },
    replies: async () => { calls.push('replies'); return { skipped: true, summary: '새 댓글 없음' }; },
    returnVisit: async () => { calls.push('returnVisit'); return { summary: '답방 2건' }; },
    findKeywords: async (seed) => { calls.push(`find:${seed}`); return { items: [{ keyword: `${seed} 추천`, grade: 'S' }] }; },
    engage: async ({ keyword }) => { calls.push(`engage:${keyword}`); return { summary: '공감 3' }; },
    feed: async () => { calls.push('feed'); return { summary: '공감 2' }; },
    ...overrides.steps
  };
  manager = new AutopilotManager({
    statePath,
    steps,
    now: () => NOON_KST,
    random: () => 0.5,
    // Each rest ends the test loop after the configured number of cycles.
    sleep: async (ms) => {
      waits.push(ms);
      if (waits.length >= (overrides.maxWaits || 1)) manager.stop('테스트 종료');
    },
    ...overrides.options
  });
  return { manager, calls, waits, statePath };
}

test('a cycle runs every enabled step in order, rotates topics and then rests for the interval', async () => {
  const { manager, calls, waits, statePath } = makeManager({ maxWaits: 2 });
  manager.start({ seedTopics: '캠핑, 여행', intervalMinutes: 60 });
  await manager.loopPromise;

  assert.deepEqual(calls, [
    'acceptNeighbors', 'replies', 'returnVisit', 'find:캠핑', 'engage:캠핑 추천', 'feed',
    'acceptNeighbors', 'replies', 'returnVisit', 'find:여행', 'engage:여행 추천', 'feed'
  ]);
  assert.equal(manager.cycle, 2);
  assert.equal(waits[0], 60 * 60 * 1000);
  assert.equal(manager.history[0].keyword, '여행 추천');
  assert.equal(manager.history[1].results.find((r) => r.step === 'replies').status, 'skipped');

  // Settings, enabled flag and used keywords survive a restart.
  const reloaded = new AutopilotManager({ statePath, steps: {} });
  assert.equal(reloaded.settings.seedTopics, '캠핑, 여행');
  assert.ok(reloaded.usedKeywords['캠핑 추천']);
  assert.equal(reloaded.enabled, false);
  await rm(statePath, { force: true });
});

test('a Naver protection signal stops autopilot instead of resting and repeating', async () => {
  const { manager, calls, waits, statePath } = makeManager({
    steps: { replies: async () => { calls.push('replies'); return { summary: '대댓글 1건', protectionTriggered: true }; } },
    maxWaits: 5
  });
  manager.start({ seedTopics: '캠핑' });
  await manager.loopPromise;
  assert.deepEqual(calls, ['acceptNeighbors', 'replies']);
  assert.equal(waits.length, 0);
  assert.equal(manager.enabled, false);
  assert.match(manager.message, /보호조치/);
  await rm(statePath, { force: true });
});

test('autopilot waits outside active hours, while disconnected, and while a manual job runs', async () => {
  let connected = false;
  let busy = '이웃 새글 소통';
  const { manager, calls, waits, statePath } = makeManager({
    maxWaits: 4,
    options: {
      isConnected: () => connected,
      getBusyLabel: () => busy
    }
  });
  manager.start({ seedTopics: '캠핑', activeStartHour: 13, activeEndHour: 23 });
  await manager.loopPromise;
  // The first three waits are: until 13:00, a retry for login, a retry for the busy job.
  assert.equal(waits[0], 60 * 60 * 1000);
  assert.equal(calls.length, 0);
  assert.equal(manager.enabled, false);

  // Validation catches a missing topic and an empty step list.
  assert.throws(() => manager.start({ seedTopics: '', steps: { engage: true } }), /주제/);
  assert.throws(() => manager.start({ seedTopics: '캠핑', steps: { acceptNeighbors: false, replies: false, returnVisit: false, engage: false, feed: false } }), /하나 이상/);
  connected = true;
  busy = '';
  await rm(statePath, { force: true });
});

test('a failing step is recorded and the cycle continues; no fresh keyword skips engagement', async () => {
  const { manager, calls, statePath } = makeManager({
    steps: {
      acceptNeighbors: async () => { throw new Error('네트워크 오류'); },
      findKeywords: async () => ({ items: [{ keyword: '캠핑 텐트', grade: 'C' }] })
    }
  });
  manager.start({ seedTopics: '캠핑' });
  await manager.loopPromise;
  const results = manager.history[0].results;
  assert.equal(results.find((r) => r.step === 'acceptNeighbors').status, 'failed');
  assert.equal(results.find((r) => r.step === 'engage').status, 'skipped');
  assert.ok(calls.includes('feed'));
  await rm(statePath, { force: true });
});

test('a stop reason such as an expired subscription ends autopilot', async () => {
  let reason = '';
  const { manager, statePath } = makeManager({ options: { getStopReason: () => reason } });
  reason = '이용권이 없거나 만료되어 자율 주행을 멈췄습니다.';
  assert.throws(() => manager.start({ seedTopics: '캠핑' }), /이용권/);
  reason = '';
  manager.start({ seedTopics: '캠핑' });
  reason = '이용권이 없거나 만료되어 자율 주행을 멈췄습니다.';
  await manager.loopPromise;
  assert.equal(manager.enabled, false);
  assert.match(manager.message, /이용권/);
  await rm(statePath, { force: true });
});

test('neighbor management settings default to AI screening and a 14-day sent-request cleanup', () => {
  const defaults = normalizeAutopilotSettings({});
  assert.equal(defaults.acceptMode, 'screen');
  assert.equal(defaults.cancelSentDays, 14);
  const custom = normalizeAutopilotSettings({ acceptMode: 'all', cancelSentDays: 0 });
  assert.equal(custom.acceptMode, 'all');
  assert.equal(custom.cancelSentDays, 0);
  assert.equal(normalizeAutopilotSettings({ cancelSentDays: 99 }).cancelSentDays, 14);
});

test('return visits are their own step: they run with replies switched off', async () => {
  const { manager, calls, statePath } = makeManager();
  manager.start({ seedTopics: '캠핑', returnVisitPerCycle: 5, steps: { acceptNeighbors: false, replies: false, engage: false, feed: false, returnVisit: true } });
  await manager.loopPromise;
  assert.deepEqual(calls, ['returnVisit']);
  assert.equal(manager.settings.returnVisitPerCycle, 5);
  await rm(statePath, { force: true });
});

test('dormant-neighbor pruning in autopilot is off by default and only accepts 60/90/180 days', () => {
  const defaults = normalizeAutopilotSettings({});
  assert.equal(defaults.pruneDormant, false);
  assert.equal(defaults.pruneDormantDays, 60);
  assert.equal(normalizeAutopilotSettings({ pruneDormant: true, pruneDormantDays: 90 }).pruneDormantDays, 90);
  assert.equal(normalizeAutopilotSettings({ pruneDormantDays: 5 }).pruneDormantDays, 60);
});

test('a cycle cut off by a restart stays in the history as interrupted', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const statePath = join(mkdtempSync(join(tmpdir(), 'ap-')), 'autopilot.json');
  writeFileSync(statePath, JSON.stringify({
    cycle: 5,
    history: [{ number: 3, startedAt: '2026-10-10T03:00:00Z', finishedAt: '2026-10-10T05:00:00Z', results: [] }],
    currentCycle: { number: 5, startedAt: '2026-10-10T07:00:00Z', updatedAt: '2026-10-10T07:10:00Z', finishedAt: null, results: [{ step: 'replies', label: '대댓글', status: 'done', summary: '2건' }] }
  }));
  const manager = new AutopilotManager({ statePath });
  assert.deepEqual(manager.history.map((c) => c.number), [5, 3]);
  assert.equal(manager.history[0].interrupted, true);
  assert.equal(manager.history[0].results.length, 1);
});

test('서이추 can rotate fixed keywords instead of searching golden keywords', async () => {
  const calls = [];
  const manager = new AutopilotManager({
    steps: {
      acceptNeighbors: async () => ({}), replies: async () => ({}), returnVisit: async () => ({}), feed: async () => ({}),
      findKeywords: async (seed) => { calls.push(`find:${seed}`); return { items: [] }; },
      engage: async ({ keyword }) => { calls.push(`engage:${keyword}`); return { summary: '서이추 2' }; }
    },
    sleep: async () => {}
  });
  assert.throws(() => manager.start({ keywordMode: 'fixed', fixedKeywords: '' }), /키워드/);
  manager.settings = normalizeAutopilotSettings({ keywordMode: 'fixed', fixedKeywords: '캠핑 장비, 캠핑 요리' });
  manager.enabled = true;
  await manager.runCycle();
  await manager.runCycle();
  await manager.runCycle();
  assert.deepEqual(calls, ['engage:캠핑 장비', 'engage:캠핑 요리', 'engage:캠핑 장비']);
  assert.equal(manager.history[0].keyword, '캠핑 장비');
});

test('each step keeps its own 공감·댓글·서이추 options, carried over from older saves', () => {
  const old = normalizeAutopilotSettings({ doLike: false, doComment: true, doNeighbor: false });
  assert.equal(old.feedLike, false);
  assert.equal(old.returnVisitLike, false);
  assert.equal(old.replyNeighbor, false);
  const split = normalizeAutopilotSettings({ doLike: false, feedLike: true, repliesPerCycle: 99 });
  assert.equal(split.feedLike, true);
  assert.equal(split.repliesPerCycle, 30);
  assert.equal(normalizeAutopilotSettings({}).keywordMode, 'golden');
});

test('halting for app shutdown starts no new cycle and keeps autopilot switched on', async () => {
  let release;
  const calls = [];
  const manager = new AutopilotManager({
    steps: {
      acceptNeighbors: async () => { calls.push('accept'); return {}; },
      replies: async () => ({}), returnVisit: async () => ({}), feed: async () => ({}),
      findKeywords: async () => ({ items: [{ keyword: '캠핑 추천', grade: 'S' }] }),
      engage: async () => ({ summary: 'ok' })
    },
    sleep: () => new Promise((resolve) => { release = resolve; })
  });
  manager.start({ seedTopics: '캠핑' });
  while (!release) await new Promise((r) => setTimeout(r, 5));
  manager.halt();
  release();
  await manager.loopPromise;
  assert.equal(calls.length, 1);
  assert.equal(manager.cycle, 1);
  assert.equal(manager.enabled, true);
});
