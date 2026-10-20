import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemStatus, untilText, DAILY_LIMITS } from '../lib/system-status.js';

const NOW = new Date('2026-10-20T05:00:00Z');
const byId = (status) => Object.fromEntries(status.systems.map((s) => [s.id, s]));

test('autopilot running shows the cycle, the current step and per-step states', () => {
  const status = buildSystemStatus({
    autopilot: {
      enabled: true, phase: 'running', currentStep: 'replies', cycle: 3, message: '💬 내 글 새 댓글에 대댓글 중...',
      settings: { steps: { acceptNeighbors: true, replies: true, engage: false, feed: true } },
      currentCycle: { results: [{ step: 'acceptNeighbors', status: 'done', summary: '수락 2건' }] }
    }
  }, { now: NOW });
  const ap = status.autopilot;
  assert.equal(ap.state, 'running');
  assert.equal(ap.cycle, 3);
  assert.equal(ap.currentStep.id, 'replies');
  assert.equal(ap.detail, '💬 내 글 새 댓글에 대댓글 중...');
  assert.deepEqual(ap.steps.map((s) => s.state), ['done', 'running', 'off', 'pending']);
  assert.equal(ap.steps[0].summary, '수락 2건');
  assert.equal(ap.next, null);
});

test('autopilot waiting shows when the next cycle starts', () => {
  const nextRunAt = new Date(NOW.getTime() + 25 * 60000).toISOString();
  const ap = buildSystemStatus({ autopilot: { enabled: true, phase: 'waiting', nextRunAt, cycle: 4 } }, { now: NOW }).autopilot;
  assert.equal(ap.state, 'waiting');
  assert.equal(ap.next.in, '25분 후');
  assert.equal(ap.next.clock, '14:25');
});

test('autopilot off gives a hint, but a stop reason stays visible as an error', () => {
  const off = buildSystemStatus({ autopilot: { enabled: false, message: '자율 주행이 꺼져 있습니다.' } }).autopilot;
  assert.equal(off.state, 'off');
  assert.match(off.detail, /자율 주행 탭에서 켜면/);
  const stopped = buildSystemStatus({ autopilot: { enabled: false, message: '이용권이 없거나 만료되어 자율 주행을 멈췄습니다.' } }).autopilot;
  assert.equal(stopped.state, 'error');
  assert.match(stopped.detail, /만료/);
});

test('running jobs are flagged busy with a progress line; idle ones show the last result', () => {
  const status = buildSystemStatus({
    engagement: { state: 'running', stats: { processedCount: 4, targetCount: 20, currentKeyword: '제주 여행', currentPost: { bloggerName: '맛집탐험가' } } },
    feed: { state: 'completed', stats: { processedCount: 10, likedCount: 8, commentedCount: 6 } },
    repliesActive: true,
    cleaner: { state: 'completed', stats: { type: 'received', accepted: 3, rejected: 1 } },
    neighborHealth: { state: 'idle', prunedToday: 5, dailyLimit: 30 },
    neighborAuto: { state: 'idle' }
  });
  const rows = byId(status);
  assert.equal(rows.engagement.state, 'running');
  assert.match(rows.engagement.detail, /'제주 여행' 4\/20 · @맛집탐험가/);
  assert.equal(rows.feed.state, 'idle');
  assert.match(rows.feed.detail, /공감 8 · 댓글 6/);
  assert.equal(rows.replies.state, 'running');
  assert.match(rows.cleaner.detail, /수락 3 · 거절 1/);
  assert.match(rows.health.detail, /5\/30명/);
  assert.equal(rows.neighborAuto, undefined, 'the tab-less 이웃 추가 job shows only while active');
  assert.deepEqual(status.busy, ['engagement', 'replies']);
});

test('environment rows: AI engine, Naver login, license and update', () => {
  const rows = byId(buildSystemStatus({
    ai: { engine: 'local', label: 'Gemma 4 E2B', runtime: { status: 'running', acceleration: 'GPU' } },
    naver: { connected: false },
    license: { status: 'valid', daysLeft: 2 },
    update: { status: 'ready', currentVersion: '1.0.40', version: '1.0.41' }
  }));
  assert.equal(rows.ai.state, 'ok');
  assert.match(rows.ai.detail, /Gemma 4 E2B · GPU/);
  assert.equal(rows.naver.state, 'error');
  assert.equal(rows.license.state, 'warn');
  assert.equal(rows.license.label, 'D-2');
  assert.equal(rows.update.state, 'warn');
  assert.match(rows.update.detail, /1\.0\.41/);

  const cloud = byId(buildSystemStatus({ ai: { engine: 'claude', cloudConnected: true, label: 'Claude' }, license: { status: 'expired' } }));
  assert.equal(cloud.ai.state, 'ok');
  assert.equal(cloud.license.state, 'error');
});

test("today's usage comes with the daily caps", () => {
  const { today } = buildSystemStatus({ usage: { likes: 12, comments: 40, neighbors: 7 } });
  assert.deepEqual(today, { likes: 12, comments: 40, neighbors: 7, limits: { ...DAILY_LIMITS } });
});

test('untilText', () => {
  assert.equal(untilText('', NOW), '');
  assert.equal(untilText(new Date(NOW.getTime() - 1000).toISOString(), NOW), '곧 시작');
  assert.equal(untilText(new Date(NOW.getTime() + 125 * 60000).toISOString(), NOW), '2시간 5분 후');
});
