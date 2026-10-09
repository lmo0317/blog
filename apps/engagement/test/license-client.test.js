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
