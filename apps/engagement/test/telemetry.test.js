import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { TelemetryReporter, summarizeValues } from '../lib/telemetry.js';

test('summaries keep numbers and short words, never passwords or typed text', () => {
  const summary = summarizeValues({
    password: 'secret-pass', email: 'a@b.com', commentText: '오늘 글 잘 봤어요', keyword: '캠핑', maxCount: 20, dryRun: false,
    posts: [1, 2, 3], nested: { count: 0, token: 'abc' }, longNote: 'x'.repeat(80), logs: [{ message: 'hi' }]
  });
  assert.deepStrictEqual(summary, { keyword: '캠핑', maxCount: 20, dryRun: false, posts: { count: 3 }, nested: { count: 0 }, longNote: '(80자)' });
});

test('API calls, failures and automation log lines are queued and sent with the status', async () => {
  const manager = { logs: [{ type: 'info', message: 'old line' }] };
  const sent = [];
  const reporter = new TelemetryReporter({
    licenseClient: { state: { token: 'tok' }, serverUrl: 'http://license', hwid: 'PC-1' },
    collectStatus: async () => ({ appVersion: '9.9.9' }),
    logSources: { engagement: () => manager },
    fetchFn: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true }; }
  });
  // start() does this; lines from before the program started are not sent again.
  reporter.markExistingLogsSeen();
  const app = express();
  app.use(express.json());
  app.use(reporter.middleware());
  app.get('/api/comment-management/scan', (_req, res) => res.json({ ok: true, posts: 0, comments: [] }));
  app.get('/api/engagement/status', (_req, res) => res.json({ state: 'idle' }));
  app.post('/api/feed/start', (_req, res) => res.status(400).json({ error: '네이버 로그인이 필요합니다.' }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/comment-management/scan`);
    await fetch(`${base}/api/comment-management/scan`);
    await fetch(`${base}/api/engagement/status`);
    await fetch(`${base}/api/feed/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'x', maxPosts: 5 }) });
    await new Promise((r) => setTimeout(r, 50));
    manager.logs.unshift({ type: 'success', message: '댓글 작성 완료', timestamp: new Date().toISOString() });

    const result = await reporter.flush();
    assert.strictEqual(result.ok, true);
    const body = sent[0].body;
    assert.strictEqual(sent[0].url, 'http://license/api/client/report');
    assert.strictEqual(body.hwid, 'PC-1');
    assert.strictEqual(body.status.appVersion, '9.9.9');
    const scan = body.events.find((e) => e.data.path === '/api/comment-management/scan');
    assert.deepStrictEqual(scan.data.result, { ok: true, posts: 0, comments: { count: 0 } });
    assert.strictEqual(scan.data.repeat, 2);
    assert.ok(!body.events.some((e) => e.data.path === '/api/engagement/status'));
    const failed = body.events.find((e) => e.type === 'api_error');
    assert.strictEqual(failed.data.error, '네이버 로그인이 필요합니다.');
    assert.deepStrictEqual(failed.data.request, { maxPosts: 5 });
    const logs = body.events.filter((e) => e.type === 'log');
    assert.deepStrictEqual(logs.map((e) => e.data.message), ['댓글 작성 완료']);
    assert.strictEqual(reporter.queue.length, 0);
  } finally {
    server.close();
  }
});

test('nothing is sent before the customer logs in, and a failed send keeps the queue', async () => {
  const client = { state: { token: null }, serverUrl: 'http://license', hwid: 'PC-1' };
  const reporter = new TelemetryReporter({ licenseClient: client, fetchFn: async () => ({ ok: false, status: 500 }) });
  reporter.track('app_start', { version: '1' });
  assert.strictEqual((await reporter.flush()).skipped, true);
  client.state.token = 'tok';
  assert.strictEqual((await reporter.flush()).ok, false);
  assert.strictEqual(reporter.queue.length, 1);
});

test('a log source made later in server startup does not break the reporter', () => {
  let later;
  const reporter = new TelemetryReporter({ licenseClient: { state: {} }, logSources: { feed: () => later } });
  // eslint-disable-next-line no-unused-vars
  const broken = new TelemetryReporter({ licenseClient: { state: {} }, logSources: { feed: () => { throw new ReferenceError('not yet'); } } });
  later = { logs: [{ type: 'info', message: 'ready' }] };
  reporter.collectLogs();
  assert.strictEqual(reporter.queue.at(-1).data.message, 'ready');
  broken.collectLogs();
  assert.strictEqual(broken.queue.length, 0);
});

test('the report shows which autopilot steps are on, each step result, and the local AI notes', async () => {
  const { summarizeValues, TelemetryReporter } = await import('../lib/telemetry.js');
  const s = summarizeValues({ settings: { steps: { feed: false, engage: true } }, currentCycle: { results: [{ step: 'replies', status: 'skipped', summary: '답할 새 댓글이 없습니다.', seconds: 3 }] }, posts: [1, 2] });
  assert.deepEqual(s.settings.steps, { feed: false, engage: true });
  assert.equal(s.currentCycle.results[0].status, 'skipped');
  assert.deepEqual(s.posts, { count: 2 });
  const ai = { logs: [{ time: 't', text: '로컬 AI 준비 완료: gemma-4-e2b, CPU, 95초', stream: 'info' }, { time: 't', text: 'slot update_slots: id 0 | task 1', stream: 'stderr' }, { time: 't', text: 'error: failed to load model', stream: 'stderr' }] };
  const reporter = new TelemetryReporter({ logSources: { ai: () => ai } });
  reporter.collectLogs();
  assert.deepEqual(reporter.queue.map((e) => e.data.level), ['info', 'error']);
});
