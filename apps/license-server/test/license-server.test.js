import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  createJwt,
  verifyJwt,
  generateLicenseKey
} from '../lib/crypto-utils.js';
import { LicenseDatabase } from '../lib/db.js';
import { LicenseService } from '../lib/license-service.js';
import { createLicenseServer } from '../server.js';

test('crypto-utils hashes and verifies passwords correctly', () => {
  const { hash, salt } = hashPassword('mySecurePassword123');
  assert.ok(hash && hash.length > 32);
  assert.ok(salt && salt.length > 16);

  assert.strictEqual(verifyPassword('mySecurePassword123', hash, salt), true);
  assert.strictEqual(verifyPassword('wrongPassword', hash, salt), false);
  assert.strictEqual(verifyPassword('', hash, salt), false);
});

test('crypto-utils creates and verifies JWT tokens with HMAC-SHA256', () => {
  const secret = 'test-secret-key-12345';
  const payload = { userId: 42, email: 'tester@example.com' };
  const token = createJwt(payload, secret, 3600);

  const verification = verifyJwt(token, secret);
  assert.strictEqual(verification.valid, true);
  assert.strictEqual(verification.payload.userId, 42);
  assert.strictEqual(verification.payload.email, 'tester@example.com');

  // Tampered token check
  const tampered = token.slice(0, -4) + 'abcd';
  const tamperedResult = verifyJwt(tampered, secret);
  assert.strictEqual(tamperedResult.valid, false);

  // Expired token check
  const expiredToken = createJwt(payload, secret, -10);
  const expiredResult = verifyJwt(expiredToken, secret);
  assert.strictEqual(expiredResult.valid, false);
  assert.strictEqual(expiredResult.error, 'Token expired');
});

test('crypto-utils generates license key with correct format', () => {
  const key = generateLicenseKey('MATE');
  assert.match(key, /^MATE-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
});

test('LicenseService handles registration, login, and trial license', () => {
  const db = new LicenseDatabase(':memory:');
  const service = new LicenseService(db, { defaultTrialDays: 3 });

  // 1. Registration
  const regResult = service.register({
    email: 'user1@example.com',
    password: 'password123',
    name: '테스터',
    hwid: 'hwid-pc-1111'
  });
  assert.strictEqual(regResult.ok, true);
  assert.strictEqual(regResult.user.email, 'user1@example.com');
  assert.strictEqual(regResult.user.hwid, 'hwid-pc-1111');
  assert.strictEqual(regResult.license.planType, 'free_trial');
  assert.strictEqual(regResult.license.daysLeft >= 2, true);
  assert.ok(regResult.token);

  // Duplicate email check
  const dupResult = service.register({
    email: 'user1@example.com',
    password: 'password123'
  });
  assert.strictEqual(dupResult.ok, false);
  assert.strictEqual(dupResult.error, 'EMAIL_ALREADY_EXISTS');

  // 2. Login
  const loginResult = service.login({
    email: 'user1@example.com',
    password: 'password123',
    hwid: 'hwid-pc-1111'
  });
  assert.strictEqual(loginResult.ok, true);
  assert.strictEqual(loginResult.license.isExpired, false);

  // Invalid password check
  const badLogin = service.login({
    email: 'user1@example.com',
    password: 'wrong-password',
    hwid: 'hwid-pc-1111'
  });
  assert.strictEqual(badLogin.ok, false);
  assert.strictEqual(badLogin.error, 'INVALID_PASSWORD');
});

test('1인 1PC HWID lock blocks unauthorized devices and allows cooldown reset', () => {
  const db = new LicenseDatabase(':memory:');
  const service = new LicenseService(db, { deviceResetCooldownDays: 30 });

  service.register({
    email: 'user2@example.com',
    password: 'password123',
    hwid: 'pc-primary-hwid'
  });

  // Login on unauthorized PC
  const foreignLogin = service.login({
    email: 'user2@example.com',
    password: 'password123',
    hwid: 'pc-unauthorized-hwid'
  });
  assert.strictEqual(foreignLogin.ok, false);
  assert.strictEqual(foreignLogin.error, 'UNAUTHORIZED_DEVICE');

  // Verify license on unauthorized PC
  const authLogin = service.login({
    email: 'user2@example.com',
    password: 'password123',
    hwid: 'pc-primary-hwid'
  });
  const verifyForeign = service.verifyLicense({
    token: authLogin.token,
    hwid: 'pc-unauthorized-hwid'
  });
  assert.strictEqual(verifyForeign.valid, false);
  assert.strictEqual(verifyForeign.error, 'UNAUTHORIZED_DEVICE');

  // Reset device works
  const resetResult = service.resetDevice({
    email: 'user2@example.com',
    password: 'password123',
    newHwid: 'pc-secondary-hwid'
  });
  assert.strictEqual(resetResult.ok, true);

  // Now secondary device can log in
  const secondaryLogin = service.login({
    email: 'user2@example.com',
    password: 'password123',
    hwid: 'pc-secondary-hwid'
  });
  assert.strictEqual(secondaryLogin.ok, true);

  // Immediate second reset is blocked by 30-day cooldown
  const instantReset = service.resetDevice({
    email: 'user2@example.com',
    password: 'password123',
    newHwid: 'pc-third-hwid'
  });
  assert.strictEqual(instantReset.ok, false);
  assert.strictEqual(instantReset.error, 'DEVICE_RESET_COOLDOWN');
});

test('License activation and Toss webhook extends expiry by 30 days', () => {
  const db = new LicenseDatabase(':memory:');
  const service = new LicenseService(db, { defaultTrialDays: 1 });

  service.register({
    email: 'subscriber@example.com',
    password: 'password123',
    hwid: 'pc-subscriber'
  });

  // Activate license key
  const activateRes = service.activateLicenseKey({
    email: 'subscriber@example.com',
    licenseKey: 'MATE-9999-8888-7777',
    hwid: 'pc-subscriber'
  });
  assert.strictEqual(activateRes.ok, true);
  assert.strictEqual(activateRes.license.daysLeft >= 30, true);

  // Toss webhook event
  const tossRes = service.handleTossWebhook({
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: {
      orderId: 'toss_order_12345',
      status: 'DONE',
      totalAmount: 9900,
      customerEmail: 'subscriber@example.com'
    }
  });
  assert.strictEqual(tossRes.ok, true);
  assert.strictEqual(tossRes.status, 'PROCESSED');

  const afterToss = service.login({
    email: 'subscriber@example.com',
    password: 'password123',
    hwid: 'pc-subscriber'
  });
  // 30 days trial/activation + 30 days toss webhook = ~60 days
  assert.strictEqual(afterToss.license.daysLeft >= 59, true);
});

test('Order sync handles Kmong and SmartStore purchases', () => {
  const db = new LicenseDatabase(':memory:');
  const service = new LicenseService(db);

  const syncRes = service.handleOrderSync({
    provider: 'kmong',
    orderId: 'KMONG-ORDER-99',
    email: 'kmong-buyer@example.com',
    months: 2
  });
  assert.strictEqual(syncRes.ok, true);
  assert.strictEqual(syncRes.license.daysLeft >= 59, true);

  const loginBuyer = service.login({
    email: 'kmong-buyer@example.com',
    password: 'welcome1234!',
    hwid: 'buyer-laptop'
  });
  assert.strictEqual(loginBuyer.ok, true);
  assert.strictEqual(loginBuyer.license.daysLeft >= 59, true);
});

test('Heartbeat pings session and returns valid status', () => {
  const db = new LicenseDatabase(':memory:');
  const service = new LicenseService(db, { defaultTrialDays: 5 });

  const reg = service.register({
    email: 'hb@example.com',
    password: 'password123',
    hwid: 'hb-pc'
  });

  const hbRes = service.heartbeat({
    token: reg.token,
    hwid: 'hb-pc',
    ip: '127.0.0.1'
  });
  assert.strictEqual(hbRes.ok, true);
  assert.strictEqual(hbRes.valid, true);
  assert.strictEqual(hbRes.daysLeft >= 4, true);
});

test('Express API server routes respond properly', async () => {
  const db = new LicenseDatabase(':memory:');
  const { app } = createLicenseServer(db);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Health
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthJson = await healthRes.json();
    assert.strictEqual(healthJson.status, 'ok');

    // 2. Register
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'api-user@example.com',
        password: 'password123',
        hwid: 'api-pc-hwid'
      })
    });
    const regJson = await regRes.json();
    assert.strictEqual(regJson.ok, true);
    assert.ok(regJson.token);

    // 3. Verify
    const verifyRes = await fetch(`${baseUrl}/api/license/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${regJson.token}`
      },
      body: JSON.stringify({ hwid: 'api-pc-hwid' })
    });
    const verifyJson = await verifyRes.json();
    assert.strictEqual(verifyJson.ok, true);
    assert.strictEqual(verifyJson.valid, true);

    // 4. Heartbeat
    const hbRes = await fetch(`${baseUrl}/api/license/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${regJson.token}`
      },
      body: JSON.stringify({ hwid: 'api-pc-hwid' })
    });
    const hbJson = await hbRes.json();
    assert.strictEqual(hbJson.ok, true);
    assert.strictEqual(hbJson.valid, true);

  } finally {
    server.close();
    db.close();
  }
});
