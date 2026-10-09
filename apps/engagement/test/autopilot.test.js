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
    'acceptNeighbors', 'replies', 'find:캠핑', 'engage:캠핑 추천', 'feed',
    'acceptNeighbors', 'replies', 'find:여행', 'engage:여행 추천', 'feed'
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
  assert.throws(() => manager.start({ seedTopics: '캠핑', steps: { acceptNeighbors: false, replies: false, engage: false, feed: false } }), /하나 이상/);
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
