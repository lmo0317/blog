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

test('내 정보 page: Google shows the account and its days left; a web token reads it for an hour, and nothing else', async () => {
  await withServer(async ({ base, post, created }) => {
    const none = await post('/api/account/google', { credential: 'good-token-for-old-customer' });
    assert.equal(none.status, 404);
    assert.equal(none.json.error, 'NO_ACCOUNT');

    created.service.register({ email: 'old@example.com', password: 'secret12', hwid: 'pc-old', consent: '2026-10-20' });
    const seen = await post('/api/account/google', { credential: 'good-token-for-old-customer' });
    assert.equal(seen.status, 200);
    const a = seen.json.account;
    assert.equal(a.email, 'old@example.com');
    assert.equal(a.license.planType, 'free_trial');
    assert.equal(a.license.daysLeft, 3);
    assert.equal(a.license.keyTail.length, 4);
    assert.equal(a.device.registered, true);
    assert.equal(a.device.canMoveNow, true);
    assert.ok(a.consentAt);
    assert.equal(JSON.stringify(a).includes('pc-old'), false, 'the PC id is not shown');
    assert.equal(JSON.stringify(a).includes('password'), false);

    const me = await fetch(`${base}/api/account/me`, { headers: { Authorization: `Bearer ${seen.json.token}` } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).account.email, 'old@example.com');

    // an app login token is not a web-account token
    const appToken = created.service.login({ email: 'old@example.com', password: 'secret12', hwid: 'pc-old' }).token;
    assert.equal((await fetch(`${base}/api/account/me`, { headers: { Authorization: `Bearer ${appToken}` } })).status, 401);
    assert.equal((await fetch(`${base}/api/account/me`)).status, 401);
    assert.equal((await post('/api/account/google', { credential: 'token-for-another-app-xxxx' })).status, 400);
  });
});

test('내 정보 page, redirect mode: the callback hands a web token (or "no account") back to the page, and checks the CSRF cookie', async () => {
  await withServer(async ({ base, created }) => {
    const back = async (credential, { csrf = 'c9', formCsrf = csrf } = {}) => {
      const res = await fetch(`${base}/api/account/google/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `g_csrf_token=${csrf}` },
        body: new URLSearchParams({ credential, g_csrf_token: formCsrf }).toString()
      });
      const html = await res.text();
      const start = html.indexOf("setItem('nm_account_handoff',") + "setItem('nm_account_handoff',".length;
      return { html, handoff: start > 30 ? JSON.parse(JSON.parse(html.slice(start, html.indexOf(')}catch', start)))) : null };
    };
    const none = await back('good-token-for-new-customer');
    assert.equal(none.handoff.error, 'NO_ACCOUNT');
    assert.equal(none.handoff.email, 'new.customer@gmail.com');
    assert.ok(none.html.includes("location.replace('/neighbormate-app/account.html')"));

    created.service.register({ email: 'old@example.com', password: 'secret12', hwid: 'pc-old' });
    const ok = await back('good-token-for-old-customer');
    const me = await fetch(`${base}/api/account/me`, { headers: { Authorization: `Bearer ${ok.handoff.token}` } });
    assert.equal((await me.json()).account.email, 'old@example.com');

    assert.equal((await back('good-token-for-old-customer', { formCsrf: 'other' })).handoff.error, 'CSRF');
    assert.equal((await back('made-up-token-xxxxxxxxxxx')).handoff.error, 'GOOGLE_VERIFY_FAILED');
    assert.equal(/<\/script>.*<\/script>/s.test(ok.html), false, 'one script tag, nothing injected');

    // The page can also come back through the program's return address, marked by its cookie.
    const viaApp = await fetch(`${base}/api/auth/google/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'g_csrf_token=c7; nm_account_trip=1' },
      body: new URLSearchParams({ credential: 'good-token-for-old-customer', g_csrf_token: 'c7' }).toString()
    });
    const viaHtml = await viaApp.text();
    assert.ok(viaHtml.includes('nm_account_handoff') && viaHtml.includes('/neighbormate-app/account.html'));
    assert.match(viaApp.headers.get('set-cookie'), /nm_account_trip=;/);
  });
});
