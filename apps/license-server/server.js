import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LicenseDatabase } from './lib/db.js';
import { LicenseService } from './lib/license-service.js';
import { QnaService } from './lib/qna-service.js';
import { VisitService } from './lib/visit-service.js';
import { ClientReportService } from './lib/client-report-service.js';
import { InsightsService } from './lib/insights-service.js';
import { InquiryService } from './lib/inquiry-service.js';
import { Mailer } from './lib/mailer.js';
import { GoogleAuth, googleStartPage, googleDonePage, STATE_COOKIE } from './lib/google-auth.js';

export function createLicenseServer(db = null, options = {}) {
  const app = express();
  const database = db || new LicenseDatabase();
  const service = new LicenseService(database, options);
  const qna = new QnaService(database, options.qna);
  const visits = new VisitService(database, options.visits);
  const reports = new ClientReportService(database, service, options.reports);
  const inquiries = new InquiryService(database, { mailer: options.mailer || new Mailer(), notifyTo: process.env.INQUIRY_NOTIFY_TO, ...(options.inquiries || {}) });
  const googleAuth = options.googleAuth || new GoogleAuth();
  const insights = new InsightsService(database, { service, reports, visits, ...(options.insights || {}) });

  app.use(express.json({ limit: '2mb' }));

  // CORS middleware for client communication
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    return (forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress) || '';
  };

  const getBearerToken = (req) => {
    const authHeader = req.headers['authorization'];
    return authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : (req.body?.token || null);
  };

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'neighbor-license-server', timestamp: new Date().toISOString() });
  });

  // Auth: Register
  app.post('/api/auth/register', (req, res) => {
    const { email, password, name, licenseKey, hwid, consent } = req.body || {};
    const ip = getClientIp(req);
    const result = service.register({ email, password, name, licenseKey, hwid, consent, ip });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // Auth: Login
  app.post('/api/auth/login', (req, res) => {
    const { email, password, hwid } = req.body || {};
    const ip = getClientIp(req);
    const result = service.login({ email, password, hwid, ip });
    res.status(result.ok ? 200 : (result.error === 'UNAUTHORIZED_DEVICE' ? 403 : 401)).json(result);
  });

  // Auth: "Google로 시작하기" (see lib/google-auth.js). The app opens /start in the browser and polls /poll.
  const readCookie = (req, name) => {
    const hit = String(req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
  };
  const googleBase = 'https://minohlee.mooo.com/license/api/auth/google';

  app.get('/api/auth/google/start', (req, res) => {
    const state = String(req.query.state || '');
    if (!googleAuth.isState(state)) return res.status(400).type('text/plain; charset=utf-8').send('앱에서 [Google로 시작하기]를 다시 눌러 주세요.');
    // Google posts back from its own site, so the cookie must be SameSite=None.
    res.setHeader('Set-Cookie', `${STATE_COOKIE}=${state}; Path=/; Max-Age=900; Secure; HttpOnly; SameSite=None`);
    res.type('html').send(googleStartPage({
      clientId: googleAuth.clientId,
      loginUri: `${googleBase}/callback`,
      termsUrl: 'https://minohlee.mooo.com/neighbormate-app/terms.html',
      privacyUrl: 'https://minohlee.mooo.com/neighbormate-app/privacy.html'
    }));
  });

  // Google's redirect: a form post with the ID token and a CSRF token that must match its cookie.
  app.post('/api/auth/google/callback', express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
    const csrf = readCookie(req, 'g_csrf_token');
    if (!csrf || csrf !== req.body?.g_csrf_token) {
      return res.status(400).type('html').send(googleDonePage({ ok: false, message: '보안 확인에 실패했습니다.' }));
    }
    const result = await googleAuth.complete({ state: readCookie(req, STATE_COOKIE), credential: req.body?.credential });
    res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None`);
    res.status(result.ok ? 200 : 400).type('html').send(googleDonePage(result));
  });

  app.post('/api/auth/google/poll', (req, res) => {
    const { state, hwid } = req.body || {};
    if (!googleAuth.isState(state)) return res.status(400).json({ ok: false, error: 'INVALID_STATE', message: '앱에서 다시 시작해 주세요.' });
    const who = googleAuth.take(state);
    if (!who) return res.status(202).json({ ok: false, pending: true });
    const result = service.googleSignIn({ email: who.email, name: who.name, hwid, ip: getClientIp(req) });
    res.status(result.ok ? 200 : (result.error === 'UNAUTHORIZED_DEVICE' ? 403 : 400)).json(result);
  });

  // Account: agree to the current 이용약관·개인정보 처리방침
  app.post('/api/account/consent', (req, res) => {
    const result = service.recordConsent({ token: getBearerToken(req), version: req.body?.version, ip: getClientIp(req) });
    res.status(result.ok ? 200 : (result.error === 'LOGIN_REQUIRED' ? 401 : 400)).json(result);
  });

  // License: Verify
  app.post('/api/license/verify', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : (req.body?.token || null);
    const { hwid, licenseKey } = req.body || {};
    const ip = getClientIp(req);
    const result = service.verifyLicense({ token, hwid, licenseKey, ip });
    res.status(result.ok ? 200 : (result.error === 'UNAUTHORIZED_DEVICE' ? 403 : 400)).json(result);
  });

  // License: Heartbeat (every 10 minutes)
  app.post('/api/license/heartbeat', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : (req.body?.token || null);
    const { hwid } = req.body || {};
    const ip = getClientIp(req);
    const result = service.heartbeat({ token, hwid, ip });
    res.status(result.ok ? 200 : 401).json(result);
  });

  // Program status and activity, sent every few minutes by the customer's app (see engagement lib/telemetry.js).
  app.post('/api/client/report', (req, res) => {
    const { hwid, status, events } = req.body || {};
    const result = reports.receive({ token: getBearerToken(req), hwid, status, events, ip: getClientIp(req) });
    res.status(result.ok ? 200 : (result.error === 'TOO_MANY_REPORTS' ? 429 : 401)).json(result);
  });

  // License: Activate key (logged-in account only)
  app.post('/api/license/activate', (req, res) => {
    const { licenseKey, hwid } = req.body || {};
    const ip = getClientIp(req);
    const result = service.activateLicenseKey({ token: getBearerToken(req), licenseKey, hwid, ip });
    res.status(result.ok ? 200 : (result.error === 'LOGIN_REQUIRED' ? 401 : 400)).json(result);
  });

  // License: Reset device (monthly cooldown)
  app.post('/api/license/reset-device', (req, res) => {
    const { email, password, newHwid } = req.body || {};
    const ip = getClientIp(req);
    const result = service.resetDevice({ email, password, newHwid, ip });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // Webhook: Toss Payments (payment is re-verified against the Toss API)
  app.post('/api/webhook/toss', async (req, res) => {
    const ip = getClientIp(req);
    const result = await service.handleTossWebhook(req.body || {}, ip);
    res.status(result.ok ? 200 : (result.status === 'NOT_CONFIGURED' ? 503 : 400)).json(result);
  });

  // Webhook/Order Sync: Kmong / Smartstore / manual issuance (requires LICENSE_ADMIN_SECRET)
  app.post('/api/webhook/order', (req, res) => {
    if (!service.adminSecret) {
      return res.status(503).json({ ok: false, error: 'NOT_CONFIGURED', message: 'LICENSE_ADMIN_SECRET이 설정되지 않았습니다.' });
    }
    if (!service.isAdminRequest(req.headers['x-admin-secret'])) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '인증되지 않은 요청입니다.' });
    }
    const { provider, orderId, email, months } = req.body || {};
    const ip = getClientIp(req);
    const result = service.handleOrderSync({ provider, orderId, email, months, ip });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // ---- Q&A board on the promo site (/neighbormate-app/qna.html) ----
  const qnaStatus = (result) => (result.ok ? 200 : ({ NOT_FOUND: 404, PRIVATE: 403, WRONG_PASSWORD: 403, TOO_MANY_ATTEMPTS: 429, TOO_MANY_POSTS: 429 }[result.error] || 400));
  const qnaSend = (res, result) => res.status(qnaStatus(result)).json(result);
  app.get('/api/qna', (req, res) => qnaSend(res, qna.list({ page: req.query.page, limit: req.query.limit, query: req.query.q, field: req.query.field })));
  // The board is where customers ask; each new post is mailed to the seller so it is answered quickly.
  app.post('/api/qna', (req, res) => {
    const result = qna.create({ ...(req.body || {}), ip: getClientIp(req) });
    if (result.ok && inquiries.mailer?.configured && inquiries.notifyTo) {
      const q = result.question;
      inquiries.mailer.send({
        to: inquiries.notifyTo,
        subject: `[이웃메이트 문의 게시판] ${q.isPrivate ? '🔒 ' : ''}${q.title} · ${q.nickname}`,
        text: `${q.nickname} 님이 문의 게시판에 글을 남겼습니다${q.isPrivate ? ' (비밀글)' : ''}.

제목: ${q.title}

${q.body}

답변하기: https://minohlee.mooo.com/license/admin#qna`
      }).then((sent) => { if (!sent.ok) console.warn(`[qna] 알림 메일 실패: ${sent.error}`); });
    }
    qnaSend(res, result);
  });
  app.get('/api/qna/:id', (req, res) => qnaSend(res, qna.read(req.params.id)));
  app.post('/api/qna/:id/open', (req, res) => qnaSend(res, qna.open(req.params.id, { password: req.body?.password, ip: getClientIp(req) })));
  app.post('/api/qna/:id/delete', (req, res) => qnaSend(res, qna.remove(req.params.id, { password: req.body?.password, ip: getClientIp(req) })));

  // ---- 1:1 inquiries from the contact page (/neighbormate-app/contact.html); the token is the customer's key ----
  const inquiryStatus = (result) => (result.ok ? 200 : ({ NOT_FOUND: 404, TOO_MANY: 429 }[result.error] || 400));
  const inquirySend = (res, result) => res.status(inquiryStatus(result)).json(result);
  app.post('/api/inquiries', (req, res) => inquirySend(res, inquiries.create({ ...(req.body || {}), ip: getClientIp(req) })));
  app.get('/api/inquiries/:token', (req, res) => inquirySend(res, inquiries.thread(req.params.token)));
  app.post('/api/inquiries/:token/messages', (req, res) => inquirySend(res, inquiries.reply(req.params.token, { body: req.body?.body, ip: getClientIp(req) })));

  // ---- Visitor counts for the promo site: each page sends one beacon per view ----
  app.post('/api/visit', (req, res) => {
    const { visitor, page, referrer, source, campaign, content, view, seconds, depth, seen } = req.body || {};
    const result = visits.record({ visitor, page, referrer, source, campaign, content, view, seconds, depth, seen, ip: getClientIp(req), userAgent: req.headers['user-agent'] });
    res.status(result.ok ? 204 : 400).end();
  });

  // ---- Seller admin page (크몽 판매용 이용권 발급·고객 관리) ----
  const adminDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin');
  app.get('/admin', (_req, res) => res.sendFile(path.join(adminDir, 'index.html')));

  // A wrong admin key 10 times within 15 minutes locks that IP out for the rest of the window.
  const failures = new Map();
  const ADMIN_WINDOW_MS = 15 * 60 * 1000;
  const requireAdmin = (req, res, next) => {
    if (!service.adminSecret) {
      return res.status(503).json({ ok: false, error: 'NOT_CONFIGURED', message: 'LICENSE_ADMIN_SECRET이 설정되지 않았습니다.' });
    }
    const ip = getClientIp(req);
    const now = Date.now();
    const record = failures.get(ip);
    if (record && now - record.since > ADMIN_WINDOW_MS) failures.delete(ip);
    if ((failures.get(ip)?.count || 0) >= 10) {
      return res.status(429).json({ ok: false, error: 'TOO_MANY_ATTEMPTS', message: '관리자 키를 여러 번 틀렸습니다. 15분 뒤 다시 시도해주세요.' });
    }
    if (!service.isAdminRequest(req.headers['x-admin-secret'])) {
      const current = failures.get(ip) || { count: 0, since: now };
      failures.set(ip, { count: current.count + 1, since: current.since });
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '관리자 키가 맞지 않습니다.' });
    }
    failures.delete(ip);
    next();
  };
  const send = (res, result) => res.status(result.ok ? 200 : 400).json(result);

  app.get('/api/admin/summary', requireAdmin, (_req, res) => send(res, service.adminSummary()));
  // Home: to-do list, funnel, 30-day trend, versions, news; `since` = when the admin last looked, `latest` = newest app version
  app.get('/api/admin/home', requireAdmin, (req, res) => send(res, insights.home({ since: req.query.since, latest: req.query.latest })));
  app.post('/api/admin/dismiss', requireAdmin, (req, res) => send(res, insights.dismiss(req.body?.keys || req.body?.key, { reset: req.body?.reset === true })));
  app.get('/api/admin/people', requireAdmin, (_req, res) => send(res, insights.people()));
  app.get('/api/admin/vouchers', requireAdmin, (req, res) => send(res, service.adminListVouchers({ status: req.query.status })));
  app.post('/api/admin/vouchers', requireAdmin, (req, res) => send(res, service.adminIssueVouchers(req.body || {})));
  app.post('/api/admin/vouchers/:id/delete', requireAdmin, (req, res) => send(res, service.adminDeleteVoucher(req.params.id)));
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const result = service.adminListUsers({ query: req.query.q });
    const { map, owners } = reports.overview();
    if (result.ok) result.users = result.users.map((u) => ({ ...u, owner: owners.has(u.id), client: map.get(u.id) || null }));
    send(res, result);
  });
  app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
    const base = service.adminUserDetail(req.params.id);
    if (!base.ok) return send(res, base);
    send(res, { ...base, ...reports.detail(req.params.id, { limit: req.query.limit, type: req.query.type, before: req.query.before }), ...insights.customerExtras(req.params.id) });
  });
  app.post('/api/admin/users/:id/notes', requireAdmin, (req, res) => send(res, insights.addNote(req.params.id, req.body || {})));
  app.post('/api/admin/notes/:id/delete', requireAdmin, (req, res) => send(res, insights.deleteNote(req.params.id)));
  app.post('/api/admin/users/:id/owner', requireAdmin, (req, res) => send(res, reports.setOwner(req.params.id, req.body?.mine !== false)));
  app.post('/api/admin/users/:id/extend', requireAdmin, (req, res) => send(res, service.adminExtendUser(req.params.id, req.body?.days)));
  app.post('/api/admin/users/:id/reset-device', requireAdmin, (req, res) => send(res, service.adminResetDevice(req.params.id)));

  app.get('/api/admin/visits', requireAdmin, (_req, res) => send(res, visits.stats()));
  app.get('/api/admin/visits/list', requireAdmin, (req, res) => send(res, visits.sessions({ limit: req.query.limit, includeMine: req.query.mine !== '0' })));
  // The admin page marks the browser it is opened in as the owner's ("나"); rows can be marked by hand too
  app.post('/api/admin/visits/owner', requireAdmin, (req, res) => send(res, visits.setOwner(req.body?.visitor, req.body?.mine !== false)));
  app.get('/api/admin/qna', requireAdmin, (req, res) => {
    const result = qna.adminList({ status: req.query.status });
    if (result.ok) result.questions = insights.withAskers(result.questions);
    send(res, result);
  });
  app.post('/api/admin/qna/:id/answer', requireAdmin, (req, res) => send(res, qna.adminAnswer(req.params.id, req.body?.answer)));
  app.post('/api/admin/qna/:id/delete', requireAdmin, (req, res) => send(res, qna.adminDelete(req.params.id)));
  app.get('/api/admin/inquiries', requireAdmin, (req, res) => send(res, inquiries.adminList({ status: req.query.status })));
  app.post('/api/admin/inquiries/:id/read', requireAdmin, (req, res) => send(res, inquiries.adminRead(req.params.id)));
  app.post('/api/admin/inquiries/:id/reply', requireAdmin, (req, res) => send(res, inquiries.adminReply(req.params.id, req.body?.body)));
  app.post('/api/admin/inquiries/:id/status', requireAdmin, (req, res) => send(res, inquiries.adminSetStatus(req.params.id, req.body?.status)));

  return { app, database, service, qna, visits, reports, insights, inquiries, googleAuth };
}

// Start server when run directly
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const PORT = process.env.LICENSE_SERVER_PORT || 3300;
  const { app } = createLicenseServer();
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[Neighbor License Server] 🔐 Central license server running on http://127.0.0.1:${PORT}`);
  });
}
