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

test('Made-up license keys are rejected and issued keys redeem only once', () => {
  const db = new LicenseDatabase(':memory:');
  const service = new LicenseService(db, { defaultTrialDays: 1 });

  const reg = service.register({
    email: 'subscriber@example.com',
    password: 'password123',
    hwid: 'pc-subscriber'
  });

  const fakeKey = service.activateLicenseKey({ token: reg.token, licenseKey: 'MATE-9999-8888-7777' });
  assert.strictEqual(fakeKey.ok, false);
  assert.strictEqual(fakeKey.error, 'INVALID_KEY');

  const fakeRegister = service.register({ email: 'faker@example.com', password: 'password123', licenseKey: 'MATE-1234-1234-1234' });
  assert.strictEqual(fakeRegister.ok, false);
  assert.strictEqual(db.getUserByEmail('faker@example.com'), null);

  const voucher = service.issueVoucher({ days: 30 });
  const noLogin = service.activateLicenseKey({ token: null, licenseKey: voucher.code });
  assert.strictEqual(noLogin.error, 'LOGIN_REQUIRED');

  const activated = service.activateLicenseKey({ token: reg.token, licenseKey: voucher.code, hwid: 'pc-subscriber' });
  assert.strictEqual(activated.ok, true);
  assert.strictEqual(activated.license.daysLeft >= 30, true);
  assert.strictEqual(activated.license.planType, 'monthly_paid');

  const reused = service.activateLicenseKey({ token: reg.token, licenseKey: voucher.code, hwid: 'pc-subscriber' });
  assert.strictEqual(reused.ok, false);
  assert.strictEqual(reused.error, 'KEY_ALREADY_USED');
});

test('Toss webhook only extends after the Toss API confirms the payment, once per order', async () => {
  const db = new LicenseDatabase(':memory:');
  const payments = {
    toss_order_12345: { orderId: 'toss_order_12345', status: 'DONE', totalAmount: 9900, customerEmail: 'subscriber@example.com' }
  };
  const service = new LicenseService(db, {
    defaultTrialDays: 1,
    tossSecretKey: 'test_sk',
    tossFetchPayment: async (orderId) => payments[orderId] || null
  });
  service.register({ email: 'subscriber@example.com', password: 'password123', hwid: 'pc-subscriber' });

  const forged = await service.handleTossWebhook({ eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: 'forged-1', status: 'DONE', customerEmail: 'subscriber@example.com' } });
  assert.strictEqual(forged.ok, false);
  assert.strictEqual(forged.status, 'UNVERIFIED');

  const tossRes = await service.handleTossWebhook({ eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: 'toss_order_12345', status: 'DONE' } });
  assert.strictEqual(tossRes.ok, true);
  assert.strictEqual(tossRes.status, 'PROCESSED');

  const replay = await service.handleTossWebhook({ eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: 'toss_order_12345', status: 'DONE' } });
  assert.strictEqual(replay.status, 'DUPLICATE');

  const afterToss = service.login({ email: 'subscriber@example.com', password: 'password123', hwid: 'pc-subscriber' });
  assert.strictEqual(afterToss.license.daysLeft >= 30 && afterToss.license.daysLeft <= 31, true);

  const unconfigured = new LicenseService(new LicenseDatabase(':memory:'), { tossSecretKey: '' });
  const noKey = await unconfigured.handleTossWebhook({ data: { orderId: 'x', status: 'DONE' } });
  assert.strictEqual(noKey.status, 'NOT_CONFIGURED');
});

test('Order sync extends known buyers and issues a one-time key for new buyers', () => {
  const db = new LicenseDatabase(':memory:');
  const service = new LicenseService(db);

  const syncRes = service.handleOrderSync({
    provider: 'kmong',
    orderId: 'KMONG-ORDER-99',
    email: 'kmong-buyer@example.com',
    months: 2
  });
  assert.strictEqual(syncRes.ok, true);
  assert.strictEqual(syncRes.status, 'VOUCHER_ISSUED');
  assert.match(syncRes.licenseKey, /^MATE-/);

  const duplicate = service.handleOrderSync({ provider: 'kmong', orderId: 'KMONG-ORDER-99', email: 'kmong-buyer@example.com', months: 2 });
  assert.strictEqual(duplicate.error, 'DUPLICATE_ORDER');

  const defaultPassword = service.login({ email: 'kmong-buyer@example.com', password: 'welcome1234!' });
  assert.strictEqual(defaultPassword.ok, false);

  const reg = service.register({ email: 'kmong-buyer@example.com', password: 'password123', licenseKey: syncRes.licenseKey, hwid: 'buyer-laptop' });
  assert.strictEqual(reg.ok, true);
  assert.strictEqual(reg.license.daysLeft >= 59, true);

  const renew = service.handleOrderSync({ provider: 'kmong', orderId: 'KMONG-ORDER-100', email: 'kmong-buyer@example.com', months: 1 });
  assert.strictEqual(renew.status, 'PROCESSED');
  assert.strictEqual(renew.license.daysLeft >= 89, true);
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
  const { app } = createLicenseServer(db, { adminSecret: '' });

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

    // 5. Order webhook is closed when no admin secret is configured
    const orderRes = await fetch(`${baseUrl}/api/webhook/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'X-1', email: 'api-user@example.com', months: 12 })
    });
    assert.strictEqual(orderRes.status, 503);

  } finally {
    server.close();
    db.close();
  }
});

test('Order webhook requires the admin secret header', async () => {
  const db = new LicenseDatabase(':memory:');
  const { app } = createLicenseServer(db, { adminSecret: 'admin-test-secret' });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const post = (headers) => fetch(`${baseUrl}/api/webhook/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ provider: 'smartstore', orderId: 'SS-1', months: 1 })
  });

  try {
    assert.strictEqual((await post({})).status, 401);
    assert.strictEqual((await post({ 'x-admin-secret': 'wrong' })).status, 401);
    const ok = await post({ 'x-admin-secret': 'admin-test-secret' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await ok.json()).status, 'VOUCHER_ISSUED');
  } finally {
    server.close();
    db.close();
  }
});

test('JWT secret is generated per database instead of a shared default', () => {
  const a = new LicenseService(new LicenseDatabase(':memory:'));
  const b = new LicenseService(new LicenseDatabase(':memory:'));
  if (!process.env.LICENSE_SERVER_SECRET) {
    assert.notStrictEqual(a.jwtSecret, b.jwtSecret);
    assert.ok(a.jwtSecret.length >= 64);
  }
  const token = a.register({ email: 'a@example.com', password: 'password123', hwid: 'pc-a' }).token;
  assert.strictEqual(b.verifyLicense({ token }).error, 'INVALID_TOKEN');
});

test('Seller admin issues vouchers, lists customers, extends and resets devices', async () => {
  const db = new LicenseDatabase(':memory:');
  const { app, service } = createLicenseServer(db, { adminSecret: 'admin-test-secret' });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const call = (method, url, body, secret = 'admin-test-secret') => fetch(`${baseUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
    body: body ? JSON.stringify(body) : undefined
  });

  try {
    assert.strictEqual((await call('GET', '/api/admin/summary', null, 'wrong')).status, 401);
    assert.strictEqual((await call('POST', '/api/admin/vouchers', { days: 0 })).status, 400);

    const issued = await (await call('POST', '/api/admin/vouchers', { days: 30, count: 2, memo: '크몽 #1234' })).json();
    assert.strictEqual(issued.vouchers.length, 2);
    assert.strictEqual(issued.vouchers[0].order_id, '크몽 #1234');

    // A buyer registers with one key; the other stays unused and can be deleted.
    const reg = service.register({ email: 'buyer@test.com', password: 'pw123456', licenseKey: issued.vouchers[0].code, hwid: 'PC-1' });
    assert.ok(reg.ok);
    const unused = await (await call('GET', '/api/admin/vouchers?status=unused')).json();
    assert.deepStrictEqual(unused.vouchers.map((v) => v.code), [issued.vouchers[1].code]);
    const used = await (await call('GET', '/api/admin/vouchers?status=used')).json();
    assert.strictEqual(used.vouchers[0].redeemed_email, 'buyer@test.com');
    assert.strictEqual((await call('POST', `/api/admin/vouchers/${issued.vouchers[0].id}/delete`)).status, 400);
    assert.strictEqual((await call('POST', `/api/admin/vouchers/${issued.vouchers[1].id}/delete`)).status, 200);

    const users = await (await call('GET', '/api/admin/users?q=buyer')).json();
    assert.strictEqual(users.users.length, 1);
    assert.strictEqual(users.users[0].hasDevice, true);
    const before = users.users[0].daysLeft;
    const extended = await (await call('POST', `/api/admin/users/${users.users[0].id}/extend`, { days: 30 })).json();
    assert.strictEqual(extended.daysLeft, before + 30);
    assert.strictEqual((await call('POST', `/api/admin/users/${users.users[0].id}/reset-device`)).status, 200);
    assert.strictEqual((await (await call('GET', '/api/admin/users')).json()).users[0].hasDevice, false);

    const summary = await (await call('GET', '/api/admin/summary')).json();
    assert.deepStrictEqual(summary.summary, { users: 1, paidActive: 1, trialActive: 0, unusedVouchers: 0 });
    assert.strictEqual((await fetch(`${baseUrl}/admin`)).status, 200);
  } finally {
    server.close();
    db.close();
  }
});

test('free trial is one per PC whatever email is used, and the IP does not matter', () => {
  const db = new LicenseDatabase(':memory:');
  const service = new LicenseService(db, { defaultTrialDays: 3 });
  const first = service.register({ email: 'a@example.com', password: 'password123', hwid: 'pc-1', ip: '1.1.1.1' });
  assert.strictEqual(first.license.planType, 'free_trial');

  const samePc = service.register({ email: 'b@example.com', password: 'password123', hwid: 'pc-1', ip: '2.2.2.2' });
  assert.strictEqual(samePc.ok, false);
  assert.strictEqual(samePc.error, 'TRIAL_ALREADY_USED');
  assert.strictEqual(db.getUserByEmail('b@example.com'), null);

  // A device reset by the seller does not give the PC another trial.
  db.updateUserHwid(first.user.id, null);
  assert.strictEqual(service.register({ email: 'c@example.com', password: 'password123', hwid: 'pc-1', ip: '3.3.3.3' }).ok, false);

  assert.strictEqual(service.register({ email: 'd@example.com', password: 'password123', ip: '4.4.4.4' }).error, 'TRIAL_NEEDS_DEVICE');

  // Other PCs behind the same (shared or dynamic) IP each get their own trial.
  assert.strictEqual(service.register({ email: 'e@example.com', password: 'password123', hwid: 'pc-2', ip: '1.1.1.1' }).ok, true);
  assert.strictEqual(service.register({ email: 'f@example.com', password: 'password123', hwid: 'pc-3', ip: '1.1.1.1' }).ok, true);

  // A paid key still signs up on a PC that used its trial.
  const [code] = service.adminIssueVouchers({ days: 30, count: 1 }).vouchers.map((v) => v.code);
  const paid = service.register({ email: 'g@example.com', password: 'password123', hwid: 'pc-1', ip: '1.1.1.1', licenseKey: code });
  assert.strictEqual(paid.ok, true);
  assert.notStrictEqual(paid.license.planType, 'free_trial');
});

test('trials given before trial tracking still count for their PC', () => {
  const db = new LicenseDatabase(':memory:');
  const user = db.createUser({ email: 'old@example.com', password_hash: 'x', password_salt: 'y', hwid: 'pc-old' });
  db.createLicense({ userId: user.id, licenseKey: 'MATE-OLD', planType: 'free_trial', expiresAt: new Date().toISOString(), channel: 'trial' });
  db.backfillTrialClaims();
  const service = new LicenseService(db);
  assert.strictEqual(service.register({ email: 'new@example.com', password: 'password123', hwid: 'pc-old' }).error, 'TRIAL_ALREADY_USED');
});
