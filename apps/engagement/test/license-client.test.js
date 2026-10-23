import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getHardwareFingerprint } from '../lib/hwid.js';
import { LicenseClientManager } from '../lib/license-client.js';

test('getHardwareFingerprint generates deterministic 64-character SHA-256 hash', () => {
  const hwid1 = getHardwareFingerprint({
    mockUuid: 'TEST-UUID-1234',
    mockCpu: 'Mock-CPU-i7',
    mockMem: 16,
    mockMac: 'aa:bb:cc:dd:ee:ff',
    cachePath: path.join(os.tmpdir(), `test-hwid-${Date.now()}.json`)
  });

  const hwid2 = getHardwareFingerprint({
    mockUuid: 'TEST-UUID-1234',
    mockCpu: 'Mock-CPU-i7',
    mockMem: 16,
    mockMac: 'aa:bb:cc:dd:ee:ff',
    cachePath: path.join(os.tmpdir(), `test-hwid-${Date.now()}-2.json`)
  });

  assert.strictEqual(hwid1.length, 64);
  assert.strictEqual(hwid1, hwid2);
});

test('LicenseClientManager starts unregistered and evaluates status correctly', () => {
  const tempCache = path.join(os.tmpdir(), `lic-cache-${Date.now()}.json`);
  const client = new LicenseClientManager({ cachePath: tempCache });

  const status = client.getStatus();
  assert.strictEqual(status.status, 'unregistered');
  assert.strictEqual(status.token, null);
  assert.strictEqual(status.daysLeft, 0);

  if (fs.existsSync(tempCache)) fs.unlinkSync(tempCache);
});

test('LicenseClientManager login and offline grace period handling', async () => {
  const tempCache = path.join(os.tmpdir(), `lic-cache-grace-${Date.now()}.json`);

  // Mock server responses
  const mockFetch = async (url, options) => {
    if (url.includes('/api/auth/login')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          token: 'mock-jwt-token-123',
          user: { id: 1, email: 'paid@example.com', name: '홍길동' },
          license: {
            licenseKey: 'MATE-1111-2222-3333',
            planType: 'monthly_paid',
            expiresAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
            daysLeft: 25,
            isExpired: false
          }
        })
      };
    }
    if (url.includes('/api/license/verify')) {
      throw new Error('Network offline');
    }
    return { ok: false };
  };

  const client = new LicenseClientManager({
    cachePath: tempCache,
    fetchFn: mockFetch
  });

  const loginRes = await client.login({ email: 'paid@example.com', password: 'password123' });
  assert.strictEqual(loginRes.ok, true);
  assert.strictEqual(client.state.status, 'valid');
  assert.strictEqual(client.state.daysLeft >= 24, true);

  // When network drops, verifyOnline activates offline grace
  const verifyRes = await client.verifyOnline();
  assert.strictEqual(verifyRes.ok, true);
  assert.strictEqual(verifyRes.status, 'offline_grace');
  assert.strictEqual(client.state.status, 'offline_grace');

  // Verify cache saved to disk
  assert.strictEqual(fs.existsSync(tempCache), true);

  // Logout clears cache
  client.logout();
  assert.strictEqual(client.state.status, 'unregistered');
  assert.strictEqual(fs.existsSync(tempCache), false);
});

test('createLicenseGuard blocks actions without an active license but keeps reads and license routes open', async () => {
  const { createLicenseGuard } = await import('../lib/license-client.js');
  let status = 'expired';
  const fakeClient = { getStatus: () => ({ status, message: '구독 기간이 만료되었습니다.' }) };
  let enforced = true;
  const guard = createLicenseGuard(fakeClient, () => enforced);
  const run = (method, path) => {
    const result = { next: false, code: 200, body: null };
    const res = { status(code) { result.code = code; return this; }, json(body) { result.body = body; } };
    guard({ method, path }, res, () => { result.next = true; });
    return result;
  };

  assert.strictEqual(run('POST', '/api/engagement/start').code, 402);
  assert.strictEqual(run('POST', '/api/engagement/start').body.licenseRequired, true);
  assert.strictEqual(run('GET', '/api/engagement/status').next, true);
  assert.strictEqual(run('POST', '/api/license/login').next, true);

  status = 'offline_grace';
  assert.strictEqual(run('POST', '/api/engagement/start').next, true);

  status = 'unregistered';
  enforced = false;
  assert.strictEqual(run('POST', '/api/engagement/start').next, true);
});

test('consent: signup needs it, an older account is asked once, and nothing is reported or started before it', async () => {
  const { LicenseClientManager, CONSENT_VERSION, createLicenseGuard } = await import('../lib/license-client.js');
  const { TelemetryReporter } = await import('../lib/telemetry.js');
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/api/auth/register')) return { ok: true, json: async () => ({ ok: true, token: 't', user: { email: 'a@b.co', name: 'a', consentVersion: JSON.parse(init.body).consent }, license: { planType: 'free_trial', daysLeft: 3, expiresAt: new Date(Date.now() + 3 * 864e5).toISOString() } }) };
    if (url.endsWith('/api/auth/login')) return { ok: true, json: async () => ({ ok: true, token: 't2', user: { email: 'old@b.co', name: 'o', consentVersion: null }, license: { planType: 'monthly_paid', daysLeft: 10, expiresAt: new Date(Date.now() + 10 * 864e5).toISOString() } }) };
    if (url.endsWith('/api/account/consent')) return { ok: true, json: async () => ({ ok: true, consentVersion: JSON.parse(init.body).version }) };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const client = new LicenseClientManager({ cachePath: pathMod.join(os.tmpdir(), `lc-${Date.now()}.json`), hwid: 'pc', fetchFn, serverUrl: 'http://x' });
  assert.equal((await client.register({ email: 'a@b.co', password: 'secret12' })).error, 'CONSENT_REQUIRED');
  assert.equal(calls.length, 0, 'nothing sent without consent');
  assert.equal((await client.register({ email: 'a@b.co', password: 'secret12', consent: CONSENT_VERSION })).ok, true);
  assert.equal(client.needsConsent(), false);

  client.logout();
  await client.login({ email: 'old@b.co', password: 'secret12' });
  assert.equal(client.needsConsent(), true);
  assert.equal(client.getStatus().needsConsent, true);
  const reporter = new TelemetryReporter({ licenseClient: client, fetchFn });
  reporter.track('app_start', {});
  const sent = await reporter.flush();
  assert.equal(sent.consent, false);
  assert.equal(reporter.queue.length, 0);
  let status = 0;
  createLicenseGuard(client)({ path: '/api/feed/start', method: 'POST' }, { status(code) { status = code; return this; }, json() {} }, () => { status = 200; });
  assert.equal(status, 403);
  assert.equal((await client.agree(CONSENT_VERSION)).ok, true);
  assert.equal(client.needsConsent(), false);
  client.logout();
});

test('Google로 시작하기: the app waits while the browser is open, then takes the trial with this PC', async () => {
  const sent = [];
  let picked = false;
  const fetchFn = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    if (!picked) return { ok: false, status: 202, json: async () => ({ ok: false, pending: true }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true, isNew: true, token: 'jwt',
        user: { email: 'new@gmail.com', name: '새 고객', consentVersion: '2026-10-20' },
        license: { planType: 'free_trial', expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(), daysLeft: 3, isExpired: false }
      })
    };
  };
  const client = new LicenseClientManager({ cachePath: path.join(os.tmpdir(), `lc-g-${Date.now()}.json`), hwid: 'pc-1', fetchFn, serverUrl: 'http://lic' });
  const { state, url } = client.googleStart();
  assert.match(state, /^[a-f0-9]{32}$/);
  assert.equal(url, `http://lic/api/auth/google/start?state=${state}`);

  assert.deepEqual(await client.googlePoll(state), { ok: false, pending: true });
  assert.equal(client.state.status, 'unregistered');

  picked = true;
  const done = await client.googlePoll(state);
  client.stopHeartbeat?.();
  assert.equal(done.ok, true);
  assert.equal(done.isNew, true);
  assert.equal(client.state.status, 'valid');
  assert.equal(client.state.daysLeft, 3);
  assert.equal(client.state.email, 'new@gmail.com');
  assert.deepEqual(sent.at(-1), { url: 'http://lic/api/auth/google/poll', body: { state, hwid: 'pc-1' } });
});
