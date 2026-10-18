// Sends what the program is doing to the seller's license server, so the admin page can see whether a
// customer is really using it and where they get stuck (a trial user whose comment scan always found 0
// posts went unnoticed until they wrote on the blog).
// Sent: app version, PC and AI setup, Naver connection and own blog ID, today's counts, the API calls the
// screen makes (path, result, numbers only), and the automation log lines. Never sent: passwords, cookies,
// tokens or text the user types into the screen. Automation log lines are sent as they are, including the
// AI comment they posted (public on Naver anyway); the login screen says so.
import fs from 'node:fs';
import path from 'node:path';

const MAX_QUEUE = 3000;
const MAX_BATCH = 400;
// Polled by the screen every few seconds; they say nothing about what the user did.
const QUIET_PATHS = [/\/events$/, /\/status$/, /^\/api\/health$/, /^\/api\/app-update$/, /^\/api\/models\/runtime$/, /^\/api\/naver\/qr\/status$/, /^\/api\/telemetry/];
const SECRET_KEY = /pass|token|cookie|secret|apikey|api_key|licensekey|auth|email|text|comment|content|body|html|reply|prompt|draft|title/i;

// Numbers, booleans and short words from a request or response, never free text.
export function summarizeValues(value, depth = 0) {
  if (value == null || depth > 2) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length <= 40 && !/\s{2,}|\n/.test(value) ? value : `(${value.length}자)`;
  if (Array.isArray(value)) return { count: value.length };
  if (typeof value !== 'object') return undefined;
  const out = {};
  let n = 0;
  for (const [key, inner] of Object.entries(value)) {
    if (n >= 24) break;
    if (SECRET_KEY.test(key) && typeof inner === 'string') continue;
    if (/logs?$/i.test(key) && Array.isArray(inner)) continue;
    const summary = summarizeValues(inner, depth + 1);
    if (summary === undefined || (typeof summary === 'object' && !Array.isArray(summary) && !Object.keys(summary).length)) continue;
    out[key] = summary;
    n++;
  }
  return out;
}

export class TelemetryReporter {
  constructor({ licenseClient, queuePath, collectStatus, logSources = {}, flushIntervalMs = 2 * 60 * 1000, fetchFn = globalThis.fetch, now = () => Date.now() } = {}) {
    this.licenseClient = licenseClient;
    this.queuePath = queuePath;
    this.collectStatus = collectStatus || (async () => ({}));
    this.logSources = logSources;
    this.flushIntervalMs = flushIntervalMs;
    this.fetchFn = fetchFn;
    this.now = now;
    this.queue = [];
    this.seenLogs = new WeakSet();
    this.lastApi = new Map();
    this.timer = null;
    this.saveTimer = null;
    this.sending = false;
    this.lastSentAt = null;
    this.lastError = '';
    this.load();
  }

  // A source may point at a manager created later in server startup; until then it has no logs.
  logsOf(source) {
    try { return source()?.logs || []; } catch { return []; }
  }

  load() {
    if (!this.queuePath || !fs.existsSync(this.queuePath)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.queuePath, 'utf8'));
      if (Array.isArray(saved)) this.queue = saved.slice(-MAX_QUEUE);
    } catch { this.queue = []; }
  }

  save() {
    if (!this.queuePath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(this.queuePath), { recursive: true });
        fs.writeFileSync(this.queuePath, JSON.stringify(this.queue));
      } catch { /* a full disk must not stop the program */ }
    }, 2000);
    this.saveTimer.unref?.();
  }

  track(type, data = {}) {
    this.queue.push({ at: new Date(this.now()).toISOString(), type, data });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.save();
  }

  // Express middleware: one event per meaningful API call, with its result numbers and any error.
  middleware() {
    return (req, res, next) => {
      const urlPath = String(req.path || req.originalUrl || '').split('?')[0];
      if (!urlPath.startsWith('/api/') || QUIET_PATHS.some((re) => re.test(urlPath))) return next();
      const start = this.now();
      let responseBody;
      const json = res.json.bind(res);
      res.json = (body) => { responseBody = body; return json(body); };
      res.on('finish', () => {
        const ms = this.now() - start;
        const ok = res.statusCode < 400 && responseBody?.ok !== false;
        // The same screen refresh repeated within a minute is one event with a count.
        const key = `${req.method} ${urlPath} ${res.statusCode}`;
        const last = this.lastApi.get(key);
        if (ok && req.method === 'GET' && last && start - last.at < 60_000) { last.event.data.repeat = (last.event.data.repeat || 1) + 1; return; }
        const data = { method: req.method, path: urlPath, status: res.statusCode, ms, ok };
        const query = summarizeValues(req.query);
        if (query && Object.keys(query).length) data.query = query;
        const sent = req.method !== 'GET' ? summarizeValues(req.body) : undefined;
        if (sent && Object.keys(sent).length) data.request = sent;
        const result = summarizeValues(responseBody);
        if (result && Object.keys(result).length) data.result = result;
        if (!ok) data.error = String(responseBody?.error || responseBody?.message || res.statusMessage || '').slice(0, 300);
        const event = { at: new Date(start).toISOString(), type: ok ? 'api' : 'api_error', data };
        this.queue.push(event);
        if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
        if (req.method === 'GET') this.lastApi.set(key, { at: start, event });
        this.save();
      });
      next();
    };
  }

  markExistingLogsSeen() {
    for (const source of Object.values(this.logSources)) {
      for (const entry of this.logsOf(source)) if (entry && typeof entry === 'object') this.seenLogs.add(entry);
    }
  }

  // Automation managers keep their own newest-first log arrays; pick up the lines added since last time.
  collectLogs() {
    for (const [name, source] of Object.entries(this.logSources)) {
      const logs = this.logsOf(source);
      const fresh = [];
      for (const entry of logs) {
        if (!entry || typeof entry !== 'object' || this.seenLogs.has(entry)) continue;
        this.seenLogs.add(entry);
        fresh.push(entry);
      }
      for (const entry of fresh.reverse()) {
        this.queue.push({
          at: entry.timestamp || new Date(this.now()).toISOString(),
          type: 'log',
          data: { source: name, level: entry.type || 'info', message: String(entry.message || '').slice(0, 300) }
        });
      }
    }
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
  }

  async flush() {
    const token = this.licenseClient?.state?.token;
    if (!token || this.sending) return { ok: false, skipped: true };
    this.sending = true;
    try {
      this.collectLogs();
      const status = await this.collectStatus().catch((error) => ({ statusError: error.message }));
      const events = this.queue.slice(0, MAX_BATCH);
      const res = await this.fetchFn(`${this.licenseClient.serverUrl}/api/client/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ hwid: this.licenseClient.hwid, status, events })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.queue.splice(0, events.length);
      this.save();
      this.lastSentAt = new Date(this.now()).toISOString();
      this.lastError = '';
      return { ok: true, sent: events.length };
    } catch (error) {
      this.lastError = error.message;
      return { ok: false, error: error.message };
    } finally {
      this.sending = false;
    }
  }

  start() {
    if (this.timer) return;
    // Lines already on screen when the program starts were reported last time.
    this.markExistingLogsSeen();
    setTimeout(() => this.flush().catch(() => {}), 15_000).unref?.();
    this.timer = setInterval(() => this.flush().catch(() => {}), this.flushIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
