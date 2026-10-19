import test from 'node:test';
import assert from 'node:assert/strict';
import { LicenseDatabase } from '../lib/db.js';
import { Mailer, buildMessage } from '../lib/mailer.js';
import { createLicenseServer } from '../server.js';

const decodeBody = (message) => Buffer.from(message.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');

test('1:1 inquiry: no account, a secret link, seller mailed on each customer message, customer mailed on each answer', async () => {
  const sent = [];
  const mailer = new Mailer({ user: 'seller@example.com', pass: 'x', transport: async (envelope, message) => sent.push({ ...envelope, message }) });
  const db = new LicenseDatabase(':memory:');
  const { app, inquiries } = createLicenseServer(db, { adminSecret: 'admin-test-secret', mailer, inquiries: { maxPerHour: 2 } });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const call = (method, url, body, secret = '') => fetch(`${baseUrl}${url}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret }, body: body ? JSON.stringify(body) : undefined
  });
  const admin = (method, url, body) => call(method, url, body, 'admin-test-secret');
  try {
    assert.equal((await call('POST', '/api/inquiries', { email: 'not-an-email', body: '설치가 안 돼요 도와주세요' })).status, 400);
    assert.equal((await call('POST', '/api/inquiries', { email: 'a@b.co', body: '봇', website: 'http://spam' })).status, 400);

    const created = await (await call('POST', '/api/inquiries', { email: 'Customer@Naver.com', name: '블로거', topic: 'error', body: '앱을 켜면 AI 준비 중에서 멈춰요.' })).json();
    assert.equal(created.ok, true);
    assert.match(created.token, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(created.inquiry.email, 'customer@naver.com');
    assert.equal(created.inquiry.status, 'waiting');
    await inquiries.flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'seller@example.com');
    assert.match(decodeBody(sent[0].message), /AI 준비 중에서 멈춰요/);
    assert.match(sent[0].message, /Reply-To: <customer@naver\.com>/);

    // The thread is only reachable with the token; it never shows the IP or mail details.
    assert.equal((await call('GET', '/api/inquiries/wrong-token-wrong-token-xx')).status, 404);
    const thread = await (await call('GET', `/api/inquiries/${created.token}`)).json();
    assert.equal(thread.messages.length, 1);
    assert.equal('ip' in thread.inquiry, false);
    assert.equal('mailStatus' in thread.messages[0], false);

    // Admin sees it waiting, linked to nothing yet; answers; the customer gets the answer and the link by mail.
    assert.equal((await call('GET', '/api/admin/inquiries')).status, 401);
    let list = await (await admin('GET', '/api/admin/inquiries')).json();
    assert.equal(list.inquiries.length, 1);
    assert.equal(list.inquiries[0].unread, true);
    assert.equal(list.inquiries[0].messages[0].mailStatus, 'sent');
    const id = list.inquiries[0].id;
    assert.equal((await admin('POST', `/api/admin/inquiries/${id}/reply`, { body: '설정 > AI에서 E2B 모델을 눌러 주세요.' })).status, 200);
    await inquiries.flush();
    assert.equal(sent.length, 2);
    assert.equal(sent[1].to, 'customer@naver.com');
    const answerMail = decodeBody(sent[1].message);
    assert.match(answerMail, /E2B 모델을 눌러 주세요/);
    assert.ok(answerMail.includes(`contact.html#t=${created.token}`));

    list = await (await admin('GET', '/api/admin/inquiries')).json();
    assert.equal(list.inquiries.length, 0, 'answered inquiries leave the waiting list');
    list = await (await admin('GET', '/api/admin/inquiries?status=all')).json();
    assert.equal(list.inquiries[0].status, 'answered');
    assert.equal(list.inquiries[0].messages[1].mailStatus, 'sent');

    // The customer follows up on the same link; it is waiting again and the seller is mailed.
    const follow = await (await call('POST', `/api/inquiries/${created.token}/messages`, { body: '해결됐어요. 감사합니다!' })).json();
    assert.equal(follow.inquiry.status, 'waiting');
    assert.equal(follow.messages.map((m) => m.sender).join(','), 'customer,admin,customer');
    await inquiries.flush();
    assert.equal(sent[2].to, 'seller@example.com');

    const home = await (await admin('GET', '/api/admin/home')).json();
    assert.equal(home.kpi.waitingInquiries, 1);

    // Rate limit per IP for new inquiries.
    await call('POST', '/api/inquiries', { email: 'x@y.co', body: '두 번째 문의입니다' });
    assert.equal((await call('POST', '/api/inquiries', { email: 'x@y.co', body: '세 번째 문의입니다' })).status, 429);
  } finally {
    server.close();
  }
});

test('inquiries still work without a mail account; the message records that no mail went out', async () => {
  const db = new LicenseDatabase(':memory:');
  const { app, inquiries } = createLicenseServer(db, { adminSecret: 's', mailer: new Mailer({ user: '', pass: '' }) });
  const created = inquiries.create({ email: 'c@d.co', body: '메일 설정 없이도 접수되나요?' });
  assert.equal(created.ok, true);
  await inquiries.flush();
  assert.equal(inquiries.adminList({ status: 'all' }).inquiries[0].messages[0].mailStatus, 'off');
  assert.ok(app);
});

test('mail headers cannot be injected and Korean text survives encoding', () => {
  const message = buildMessage({ from: 'me@example.com', fromName: '이웃메이트', to: 'you@example.com', subject: '답변\r\nBcc: evil@x.com', text: '안녕하세요\n줄바꿈' });
  assert.equal(message.split('\r\n\r\n')[0].includes('Bcc:'), false);
  assert.match(message, /Subject: =\?UTF-8\?B\?/);
  assert.equal(decodeBody(message), '안녕하세요\r\n줄바꿈');
});
