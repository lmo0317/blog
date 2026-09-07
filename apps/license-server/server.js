import express from 'express';
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    return (forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress) || '';
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

  // License: Activate key
  app.post('/api/license/activate', (req, res) => {
    const { email, licenseKey, hwid } = req.body || {};
    const ip = getClientIp(req);
    const result = service.activateLicenseKey({ email, licenseKey, hwid, ip });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // License: Reset device (monthly cooldown)
  app.post('/api/license/reset-device', (req, res) => {
    const { email, password, newHwid } = req.body || {};
    const ip = getClientIp(req);
    const result = service.resetDevice({ email, password, newHwid, ip });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // Webhook: Toss Payments
  app.post('/api/webhook/toss', (req, res) => {
    const ip = getClientIp(req);
    const result = service.handleTossWebhook(req.body || {}, ip);
    res.json(result);
  });

  // Webhook/Order Sync: Kmong / Smartstore
  app.post('/api/webhook/order', (req, res) => {
    const { provider, orderId, email, months } = req.body || {};
    const ip = getClientIp(req);
    const result = service.handleOrderSync({ provider, orderId, email, months, ip });
    res.status(result.ok ? 200 : 400).json(result);
  });

  return { app, database, service };
}

// Start server when run directly
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const PORT = process.env.LICENSE_SERVER_PORT || 3300;
  const { app } = createLicenseServer();
  app.listen(PORT, () => {
    console.log(`[Neighbor License Server] 🔐 Central license server running on http://127.0.0.1:${PORT}`);
  });
}
