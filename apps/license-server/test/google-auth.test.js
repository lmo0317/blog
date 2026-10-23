import test from 'node:test';
import assert from 'node:assert/strict';
import { LicenseDatabase } from '../lib/db.js';
import { GoogleAuth } from '../lib/google-auth.js';
import { createLicenseServer } from '../server.js';

const CLIENT = 'test-client.apps.googleusercontent.com';
const tokens = {
  'good-token-for-new-customer': { aud: CLIENT, iss: 'https://accounts.google.com', exp: '9999999999', email: 'New.Customer@gmail.com', email_verified: 'true', name: '새 고객' },
  'good-token-for-old-customer': { aud: CLIENT, iss: 'accounts.google.com', exp: '9999999999', email: 'old@example.com', email_verified: 'true' },
  'token-for-another-app-xxxx': { aud: 'other-app', iss: 'accounts.google.com', exp: '9999999999', email: 'x@gmail.com', email_verified: 'true' },
  'token-with-unverified-mail': { aud: CLIENT, iss: 'accounts.google.com', exp: '9999999999', email: 'y@gmail.com', email_verified: 'false' },
  'expired-token-xxxxxxxxxxxx': { aud: CLIENT, iss: 'accounts.google.com', exp: '1000', email: 'z@gmail.com', email_verified: 'true' }
};
const fakeTokeninfo = async (url) => {
  const info = tokens[new URL(url).searchParams.get('id_token')];
  return { ok: !!info, json: async () => info || { error: 'invalid_token' } };
};

async function withServer(fn) {
  const db = new LicenseDatabase(':memory:');
  const googleAuth = new GoogleAuth({ clientId: CLIENT, fetchFn: fakeTokeninfo });
  const created = createLicenseServer(db, { adminSecret: '', googleAuth });
  const server = created.app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  // What Google's redirect does: a form post to /callback carrying the state and CSRF cookies.
  const googleBack = async (state, credential, { csrf = 'c1', formCsrf = csrf } = {}) => {
    const res = await fetch(`${base}/api/auth/google/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `nm_gstate=${state}; g_csrf_token=${csrf}` },
      body: new URLSearchParams({ credential, g_csrf_token: formCsrf }).toString()
    });
    return { status: res.status, html: await res.text() };
  };
  try {
    await fn({ base, post, created, googleBack });
  } finally {
    server.close();
  }
}

test('Google sign-in: a new Google account starts the 3-day trial without a password', async () => {
  await withServer(async ({ base, post, googleBack }) => {
    const state = GoogleAuth.newState();
    const page = await fetch(`${base}/api/auth/google/start?state=${state}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('set-cookie'), new RegExp(`nm_gstate=${state};.*SameSite=None`));
    const html = await page.text();
    assert.ok(html.includes(CLIENT) && html.includes('data-ux_mode="redirect"') && html.includes('/api/auth/google/callback') && html.includes('이용약관'));

    assert.equal((await post('/api/auth/google/poll', { state, hwid: 'pc-1' })).status, 202, 'nothing until the browser finishes');

    const done = await googleBack(state, 'good-token-for-new-customer');
    assert.equal(done.status, 200);
    assert.ok(done.html.includes('new.customer@gmail.com') && done.html.includes('로그인되었습니다'));

    const signed = await post('/api/auth/google/poll', { state, hwid: 'pc-1' });
    assert.equal(signed.status, 200);
    assert.equal(signed.json.isNew, true);
    assert.equal(signed.json.license.planType, 'free_trial');
    assert.equal(signed.json.license.daysLeft, 3);
    assert.equal(signed.json.user.consentVersion, null, 'the app asks for the ticked checkbox once after login');
    assert.ok(signed.json.token);

    assert.equal((await post('/api/auth/google/poll', { state, hwid: 'pc-1' })).status, 202, 'a state is used once');
  });
});

test('Google sign-in: an existing account logs in, and moves to a new PC at most once per 30 days', async () => {
  await withServer(async ({ post, created, googleBack }) => {
    created.service.register({ email: 'old@example.com', password: 'secret12', hwid: 'pc-old' });

    const s1 = GoogleAuth.newState();
    await googleBack(s1, 'good-token-for-old-customer');
    const same = await post('/api/auth/google/poll', { state: s1, hwid: 'pc-old' });
    assert.equal(same.json.ok, true);
    assert.equal(same.json.isNew, false);

    const s2 = GoogleAuth.newState();
    await googleBack(s2, 'good-token-for-old-customer');
    const moved = await post('/api/auth/google/poll', { state: s2, hwid: 'pc-new' });
    assert.equal(moved.json.ok, true, 'the account follows the customer to the new PC');
    assert.equal(moved.json.user.hwid, 'pc-new');
    assert.equal(created.database.getUserByEmail('old@example.com').hwid, 'pc-new', 'the old PC is no longer the one');

    const s3 = GoogleAuth.newState();
    await googleBack(s3, 'good-token-for-old-customer');
    const back = await post('/api/auth/google/poll', { state: s3, hwid: 'pc-old' });
    assert.equal(back.status, 400);
    assert.equal(back.json.error, 'DEVICE_RESET_COOLDOWN');
  });
});

test('Google sign-in: every new Google account gets its own 3-day trial, even on a PC that had one', async () => {
  await withServer(async ({ post, created, googleBack }) => {
    created.service.register({ email: 'first@example.com', password: 'secret12', hwid: 'pc-1' });
    const state = GoogleAuth.newState();
    await googleBack(state, 'good-token-for-new-customer');
    const again = await post('/api/auth/google/poll', { state, hwid: 'pc-1' });
    assert.equal(again.json.ok, true);
    assert.equal(again.json.isNew, true);
    assert.equal(again.json.license.planType, 'free_trial');
    assert.equal(again.json.license.daysLeft, 3);
    // the email form keeps the one-trial-per-PC rule
    const email = created.service.register({ email: 'second@example.com', password: 'secret12', hwid: 'pc-1' });
    assert.equal(email.error, 'TRIAL_ALREADY_USED');
  });
});

test('Google sign-in rejects tokens for another app, unverified or expired emails, forged posts and bad states', async () => {
  await withServer(async ({ base, post, googleBack }) => {
    for (const credential of ['token-for-another-app-xxxx', 'token-with-unverified-mail', 'expired-token-xxxxxxxxxxxx', 'made-up-token-xxxxxxxxxxx']) {
      const state = GoogleAuth.newState();
      const r = await googleBack(state, credential);
      assert.equal(r.status, 400, credential);
      assert.ok(r.html.includes('로그인하지 못했습니다'));
      assert.equal((await post('/api/auth/google/poll', { state, hwid: 'pc-1' })).status, 202, 'nothing to take');
    }
    const state = GoogleAuth.newState();
    const forged = await googleBack(state, 'good-token-for-new-customer', { csrf: 'c1', formCsrf: 'other' });
    assert.equal(forged.status, 400, 'the CSRF cookie must match the form');
    assert.equal((await post('/api/auth/google/poll', { state, hwid: 'pc-1' })).status, 202);
    assert.equal((await googleBack('../x', 'good-token-for-new-customer')).status, 400);
    assert.equal((await fetch(`${base}/api/auth/google/start?state=<script>`)).status, 400);
  });
});
