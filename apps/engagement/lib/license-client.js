import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHardwareFingerprint } from './hwid.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CACHE_PATH = path.resolve(__dirname, '..', 'data', 'license-cache.json');
const DEFAULT_SERVER_URL = process.env.LICENSE_SERVER_URL || 'http://127.0.0.1:3300';

export class LicenseClientManager {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || DEFAULT_SERVER_URL;
    this.cachePath = options.cachePath || DEFAULT_CACHE_PATH;
    this.hwid = options.hwid || getHardwareFingerprint();
    this.heartbeatTimer = null;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 10 * 60 * 1000; // 10 minutes
    this.fetchFn = options.fetchFn || globalThis.fetch;

    this.state = {
      token: null,
      email: null,
      name: null,
      planType: null,
      expiresAt: null,
      daysLeft: 0,
      status: 'unregistered', // 'valid', 'expired', 'unauthorized_device', 'offline_grace', 'unregistered'
      lastVerifiedAt: null,
      offlineGraceUntil: null,
      message: '이용권 등록이 필요합니다.'
    };

    this.loadCache();
  }

  loadCache() {
    if (!fs.existsSync(this.cachePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      if (data && typeof data === 'object') {
        this.state = {
          ...this.state,
          ...data
        };
        this.evaluateLocalStatus();
      }
    } catch {
      // Corrupt cache
    }
  }

  saveCache() {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.cachePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch {
      // Non-fatal
    }
  }

  evaluateLocalStatus() {
    if (!this.state.token || !this.state.email) {
      this.state.status = 'unregistered';
      this.state.message = '로그인 또는 이용권 등록이 필요합니다.';
      return;
    }

    if (!this.state.expiresAt) {
      this.state.status = 'expired';
      this.state.daysLeft = 0;
      this.state.message = '라이선스가 만료되었습니다.';
      return;
    }

    const expiry = new Date(this.state.expiresAt).getTime();
    const now = Date.now();
    const diffDays = Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)));
    this.state.daysLeft = diffDays;

    if (diffDays <= 0) {
      this.state.status = 'expired';
      this.state.message = '구독 기간이 만료되었습니다. 연장 결제가 필요합니다.';
      return;
    }

    // Check offline grace
    if (this.state.status === 'offline_grace') {
      const graceEnd = new Date(this.state.offlineGraceUntil || 0).getTime();
      if (now > graceEnd) {
        this.state.status = 'expired';
        this.state.message = '오프라인 유예 기간(24시간)이 종료되었습니다. 네트워크 연결 후 재인증해주세요.';
        return;
      }
    } else {
      this.state.status = 'valid';
      this.state.message = `정품 구독 이용 중 (D-${diffDays}일 남음)`;
    }
  }

  async verifyOnline() {
    if (!this.state.token) {
      this.state.status = 'unregistered';
      this.state.message = '로그인 또는 이용권 등록이 필요합니다.';
      return { ok: false, status: 'unregistered', message: this.state.message };
    }

    try {
      const res = await this.fetchFn(`${this.serverUrl}/api/license/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.token}`
        },
        body: JSON.stringify({ hwid: this.hwid })
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        this.state.status = data.valid ? 'valid' : 'expired';
        this.state.planType = data.license.planType;
        this.state.expiresAt = data.license.expiresAt;
        this.state.daysLeft = data.license.daysLeft;
        this.state.lastVerifiedAt = new Date().toISOString();
        // Grant 24 hours of offline grace from this point
        this.state.offlineGraceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        this.state.message = data.valid
          ? `정품 구독 이용 중 (D-${data.license.daysLeft}일 남음)`
          : '구독 기간이 만료되었습니다. 연장 결제가 필요합니다.';
        this.saveCache();
        return { ok: true, status: this.state.status, data };
      }

      if (data.error === 'UNAUTHORIZED_DEVICE') {
        this.state.status = 'unauthorized_device';
        this.state.message = '등록된 PC가 아닙니다. 1인 1PC 정책에 따라 등록된 기기에서만 이용 가능합니다.';
        this.saveCache();
        return { ok: false, status: 'unauthorized_device', message: this.state.message };
      }

      // Other server error / invalid token
      this.state.status = 'unregistered';
      this.state.message = data.message || '인증이 만료되었습니다. 다시 로그인해주세요.';
      this.saveCache();
      return { ok: false, status: 'unregistered', message: this.state.message };
    } catch (networkErr) {
      // Server offline / network failure -> apply offline grace
      const now = Date.now();
      const graceEnd = new Date(this.state.offlineGraceUntil || 0).getTime();
      if (graceEnd > now && this.state.daysLeft > 0) {
        this.state.status = 'offline_grace';
        this.state.message = `오프라인 유예 모드 동작 중 (D-${this.state.daysLeft}일 남음)`;
        this.saveCache();
        return { ok: true, status: 'offline_grace', message: this.state.message, offline: true };
      }

      this.state.status = 'unregistered';
      this.state.message = '라이선스 인증 서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.';
      return { ok: false, status: 'connection_error', message: this.state.message };
    }
  }

  async login({ email, password }) {
    try {
      const res = await this.fetchFn(`${this.serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, hwid: this.hwid })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error, message: data.message || '로그인에 실패했습니다.' };
      }

      this.state.token = data.token;
      this.state.email = data.user.email;
      this.state.name = data.user.name;
      this.state.planType = data.license?.planType || 'monthly';
      this.state.expiresAt = data.license?.expiresAt || null;
      this.state.daysLeft = data.license?.daysLeft || 0;
      this.state.status = data.license?.isExpired ? 'expired' : 'valid';
      this.state.lastVerifiedAt = new Date().toISOString();
      this.state.offlineGraceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      this.state.message = this.state.status === 'valid'
        ? `정품 구독 이용 중 (D-${this.state.daysLeft}일 남음)`
        : '구독 기간이 만료되었습니다. 연장 결제가 필요합니다.';

      this.saveCache();
      this.startHeartbeat();
      return { ok: true, message: data.message, state: this.state };
    } catch (err) {
      return { ok: false, error: 'NETWORK_ERROR', message: '라이선스 서버 연결 실패: ' + err.message };
    }
  }

  async register({ email, password, name = '', licenseKey = null }) {
    try {
      const res = await this.fetchFn(`${this.serverUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, licenseKey, hwid: this.hwid })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error, message: data.message || '회원가입에 실패했습니다.' };
      }

      this.state.token = data.token;
      this.state.email = data.user.email;
      this.state.name = data.user.name;
      this.state.planType = data.license?.planType || 'free_trial';
      this.state.expiresAt = data.license?.expiresAt || null;
      this.state.daysLeft = data.license?.daysLeft || 0;
      this.state.status = 'valid';
      this.state.lastVerifiedAt = new Date().toISOString();
      this.state.offlineGraceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      this.state.message = `정품 구독 이용 중 (D-${this.state.daysLeft}일 남음)`;

      this.saveCache();
      this.startHeartbeat();
      return { ok: true, message: data.message, state: this.state };
    } catch (err) {
      return { ok: false, error: 'NETWORK_ERROR', message: '라이선스 서버 연결 실패: ' + err.message };
    }
  }

  async activateKey(licenseKey) {
    try {
      const res = await this.fetchFn(`${this.serverUrl}/api/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: this.state.email,
          licenseKey,
          hwid: this.hwid
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error, message: data.message || '라이선스 키 활성화 실패' };
      }

      this.state.planType = data.license.planType;
      this.state.expiresAt = data.license.expiresAt;
      this.state.daysLeft = data.license.daysLeft;
      this.state.status = 'valid';
      this.state.lastVerifiedAt = new Date().toISOString();
      this.state.offlineGraceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      this.state.message = `정품 구독 이용 중 (D-${this.state.daysLeft}일 남음)`;

      this.saveCache();
      return { ok: true, message: data.message, state: this.state };
    } catch (err) {
      return { ok: false, error: 'NETWORK_ERROR', message: '라이선스 서버 연결 실패: ' + err.message };
    }
  }

  async heartbeat() {
    if (!this.state.token) return;
    try {
      const res = await this.fetchFn(`${this.serverUrl}/api/license/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.token}`
        },
        body: JSON.stringify({ hwid: this.hwid })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        this.state.daysLeft = data.daysLeft;
        this.state.expiresAt = data.expiresAt;
        if (!data.valid) {
          this.state.status = 'expired';
          this.state.message = '구독 기간이 만료되었습니다.';
        }
        this.state.lastVerifiedAt = new Date().toISOString();
        this.saveCache();
      }
    } catch {
      // Network hiccup, handled by offline grace
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat().catch(() => {});
    }, this.heartbeatIntervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  logout() {
    this.stopHeartbeat();
    this.state = {
      token: null,
      email: null,
      name: null,
      planType: null,
      expiresAt: null,
      daysLeft: 0,
      status: 'unregistered',
      lastVerifiedAt: null,
      offlineGraceUntil: null,
      message: '로그인 또는 이용권 등록이 필요합니다.'
    };
    if (fs.existsSync(this.cachePath)) {
      try {
        fs.unlinkSync(this.cachePath);
      } catch {
        // ignore
      }
    }
    return { ok: true };
  }

  getStatus() {
    this.evaluateLocalStatus();
    return {
      ...this.state,
      hwidMasked: this.hwid ? this.hwid.slice(0, 10) + '...' : null
    };
  }
}
