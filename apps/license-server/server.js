import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LicenseDatabase } from './lib/db.js';
import { LicenseService } from './lib/license-service.js';

export function createLicenseServer(db = null, options = {}) {
  const app = express();
  const database = db || new LicenseDatabase();
  const service = new LicenseService(database, options);

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
    const { email, password, name, licenseKey, hwid } = req.body || {};
    const ip = getClientIp(req);
    const result = service.register({ email, password, name, licenseKey, hwid, ip });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // Auth: Login
  app.post('/api/auth/login', (req, res) => {
    const { email, password, hwid } = req.body || {};
    const ip = getClientIp(req);
    const result = service.login({ email, password, hwid, ip });
    res.status(result.ok ? 200 : (result.error === 'UNAUTHORIZED_DEVICE' ? 403 : 401)).json(result);
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
  app.get('/api/admin/vouchers', requireAdmin, (req, res) => send(res, service.adminListVouchers({ status: req.query.status })));
  app.post('/api/admin/vouchers', requireAdmin, (req, res) => send(res, service.adminIssueVouchers(req.body || {})));
  app.post('/api/admin/vouchers/:id/delete', requireAdmin, (req, res) => send(res, service.adminDeleteVoucher(req.params.id)));
  app.get('/api/admin/users', requireAdmin, (req, res) => send(res, service.adminListUsers({ query: req.query.q })));
  app.post('/api/admin/users/:id/extend', requireAdmin, (req, res) => send(res, service.adminExtendUser(req.params.id, req.body?.days)));
  app.post('/api/admin/users/:id/reset-device', requireAdmin, (req, res) => send(res, service.adminResetDevice(req.params.id)));

  return { app, database, service };
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
