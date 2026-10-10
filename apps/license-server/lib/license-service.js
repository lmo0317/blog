import {
  hashPassword,
  verifyPassword,
  createJwt,
  verifyJwt,
  generateLicenseKey,
  safeEqual
} from './crypto-utils.js';
import crypto from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOSS_API_BASE = 'https://api.tosspayments.com/v1';

// Asks Toss for the real payment record so a forged webhook body cannot grant days.
export async function fetchTossPayment(orderId, secretKey, fetchFn = globalThis.fetch) {
  const auth = Buffer.from(`${secretKey}:`).toString('base64');
  const res = await fetchFn(`${TOSS_API_BASE}/payments/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  if (!res.ok) return null;
  return res.json();
}

export class LicenseService {
  constructor(db, options = {}) {
    this.db = db;
    // No built-in fallback: an env secret, or a random one generated once per database.
    this.jwtSecret = options.jwtSecret
      || process.env.LICENSE_SERVER_SECRET
      || db.getOrCreateSetting('jwt_secret', () => crypto.randomBytes(48).toString('hex'));
    this.defaultTrialDays = options.defaultTrialDays ?? 3;
    // A home or office shares one IP; a few trials per 30 days, then a key is needed.
    this.maxTrialsPerIp = options.maxTrialsPerIp ?? 3;
    this.deviceResetCooldownDays = options.deviceResetCooldownDays ?? 30;
    this.tossSecretKey = options.tossSecretKey ?? process.env.TOSS_SECRET_KEY ?? '';
    this.tossFetchPayment = options.tossFetchPayment
      || ((orderId) => fetchTossPayment(orderId, this.tossSecretKey));
    this.monthlyPrice = options.monthlyPrice ?? 9900;
    this.adminSecret = options.adminSecret ?? process.env.LICENSE_ADMIN_SECRET ?? '';
  }

  isAdminRequest(secret) {
    return safeEqual(secret, this.adminSecret);
  }

  // Applies paid days to an account: extends the latest license or creates one.
  grantDays(userId, days, { orderId = null, channel = 'direct' } = {}) {
    const license = this.db.getLicenseByUserId(userId);
    if (license) {
      const extended = this.db.extendLicense(license.id, days);
      if (extended.plan_type === 'free_trial') {
        this.db.db.prepare('UPDATE licenses SET plan_type = ? WHERE id = ?').run('monthly_paid', extended.id);
        return this.db.getLicenseById(extended.id);
      }
      return extended;
    }
    return this.db.createLicense({
      userId,
      licenseKey: generateLicenseKey('MATE'),
      planType: 'monthly_paid',
      expiresAt: new Date(Date.now() + days * DAY_MS).toISOString(),
      orderId,
      channel
    });
  }

  issueVoucher({ days = 30, orderId = null, channel = 'manual' } = {}) {
    let code = generateLicenseKey('MATE');
    while (this.db.getVoucherByCode(code)) code = generateLicenseKey('MATE');
    return this.db.createVoucher({ code, days, orderId, channel });
  }

  // Checks a purchased key without consuming it.
  findRedeemableVoucher(licenseKey) {
    const voucher = this.db.getVoucherByCode(String(licenseKey || '').trim());
    if (!voucher) {
      return { ok: false, error: 'INVALID_KEY', message: '유효하지 않은 라이선스 키입니다. 구매 시 받은 키를 정확히 입력해주세요.' };
    }
    if (voucher.redeemed_by) {
      return { ok: false, error: 'KEY_ALREADY_USED', message: '이미 사용된 라이선스 키입니다.' };
    }
    return { ok: true, voucher };
  }

  calcDaysLeft(expiresAtStr) {
    if (!expiresAtStr) return 0;
    const diff = new Date(expiresAtStr).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  checkTrialAllowed({ hwid, ip }) {
    const message = '이 PC에서는 이미 무료 체험을 사용했습니다. 기존 계정으로 로그인하거나, 구매한 이용권 키를 함께 입력해 가입해 주세요.';
    if (!hwid) return { ok: false, error: 'TRIAL_NEEDS_DEVICE', message: '이 PC를 확인할 수 없어 무료 체험을 시작할 수 없습니다. 이용권 키를 함께 입력해 가입해 주세요.' };
    if (this.db.getTrialClaim(hwid)) return { ok: false, error: 'TRIAL_ALREADY_USED', message };
    const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
    if (this.db.countTrialClaimsByIp(ip, since) >= this.maxTrialsPerIp) return { ok: false, error: 'TRIAL_ALREADY_USED', message };
    return null;
  }

  register({ email, password, name = '', licenseKey = null, hwid = null, ip = '' }) {
    if (!email || !email.includes('@')) {
      return { ok: false, error: 'INVALID_EMAIL', message: '올바른 이메일 주소를 입력해주세요.' };
    }
    if (!password || password.length < 6) {
      return { ok: false, error: 'WEAK_PASSWORD', message: '비밀번호는 최소 6자 이상이어야 합니다.' };
    }

    const existingUser = this.db.getUserByEmail(email);
    if (existingUser) {
      return { ok: false, error: 'EMAIL_ALREADY_EXISTS', message: '이미 등록된 이메일 계정입니다.' };
    }

    let voucher = null;
    if (licenseKey) {
      const found = this.findRedeemableVoucher(licenseKey);
      if (!found.ok) return found;
      voucher = found.voucher;
    }

    // Without a paid key this signup is a free trial: one per PC, so a new email cannot buy more days.
    if (!voucher) {
      const trialBlock = this.checkTrialAllowed({ hwid, ip });
      if (trialBlock) return trialBlock;
    }

    const { hash, salt } = hashPassword(password);
    const user = this.db.createUser({
      email,
      password_hash: hash,
      password_salt: salt,
      name: name || email.split('@')[0],
      hwid: hwid || null
    });

    let license;
    if (voucher && this.db.redeemVoucher(voucher.id, user.id)) {
      license = this.grantDays(user.id, voucher.days, { orderId: voucher.order_id, channel: voucher.channel });
    } else {
      // Free trial license (e.g. 3 days)
      this.db.addTrialClaim({ hwid, userId: user.id, ip });
      license = this.db.createLicense({
        userId: user.id,
        licenseKey: generateLicenseKey('MATE'),
        planType: 'free_trial',
        expiresAt: new Date(Date.now() + this.defaultTrialDays * DAY_MS).toISOString(),
        channel: 'trial'
      });
    }

    this.db.logAudit({
      userId: user.id,
      action: 'REGISTER',
      details: `Registered with ${license.plan_type}, hwid=${hwid || 'none'}`,
      ip
    });

    const token = createJwt({ userId: user.id, email: user.email, hwid: user.hwid }, this.jwtSecret);
    const daysLeft = this.calcDaysLeft(license.expires_at);

    return {
      ok: true,
      message: '회원가입이 완료되었습니다.',
      user: { id: user.id, email: user.email, name: user.name, hwid: user.hwid },
      license: {
        licenseKey: license.license_key,
        planType: license.plan_type,
        expiresAt: license.expires_at,
        daysLeft,
        isExpired: daysLeft <= 0
      },
      token
    };
  }

  login({ email, password, hwid = null, ip = '' }) {
    if (!email || !password) {
      return { ok: false, error: 'MISSING_CREDENTIALS', message: '이메일과 비밀번호를 입력해주세요.' };
    }

    const user = this.db.getUserByEmail(email);
    if (!user) {
      return { ok: false, error: 'USER_NOT_FOUND', message: '가입되지 않은 이메일 주소입니다.' };
    }

    const passwordValid = verifyPassword(password, user.password_hash, user.password_salt);
    if (!passwordValid) {
      return { ok: false, error: 'INVALID_PASSWORD', message: '비밀번호가 일치하지 않습니다.' };
    }

    // 1-User 1-PC HWID binding check
    if (hwid) {
      if (!user.hwid) {
        // First login with HWID: bind device
        this.db.updateUserHwid(user.id, hwid);
        user.hwid = hwid;
      } else if (user.hwid !== hwid) {
        // Mismatched device
        this.db.logAudit({
          userId: user.id,
          action: 'LOGIN_REJECTED_HWID',
          details: `Expected HWID=${user.hwid}, got=${hwid}`,
          ip
        });
        return {
          ok: false,
          error: 'UNAUTHORIZED_DEVICE',
          message: '등록된 PC가 아닙니다. 1인 1PC 정책에 따라 최초 등록된 기기에서만 이용 가능합니다. (기기 변경은 월 1회 가능)'
        };
      }
    }

    const license = this.db.getLicenseByUserId(user.id);
    const daysLeft = license ? this.calcDaysLeft(license.expires_at) : 0;
    const isExpired = daysLeft <= 0;

    const token = createJwt({ userId: user.id, email: user.email, hwid: user.hwid }, this.jwtSecret);

    this.db.logAudit({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      details: `Days left: ${daysLeft}`,
      ip
    });

    return {
      ok: true,
      message: '로그인되었습니다.',
      user: { id: user.id, email: user.email, name: user.name, hwid: user.hwid },
      license: license ? {
        licenseKey: license.license_key,
        planType: license.plan_type,
        expiresAt: license.expires_at,
        daysLeft,
        isExpired
      } : null,
      token
    };
  }

  verifyLicense({ token, hwid = null, licenseKey = null, ip = '' }) {
    let userId = null;
    let user = null;

    if (token) {
      const jwtResult = verifyJwt(token, this.jwtSecret);
      if (!jwtResult.valid) {
        return { ok: false, valid: false, error: 'INVALID_TOKEN', message: '인증 토큰이 만료되었거나 유효하지 않습니다.' };
      }
      userId = jwtResult.payload.userId;
      user = this.db.getUserById(userId);
    } else if (licenseKey) {
      const lic = this.db.getLicenseByKey(licenseKey);
      if (!lic) {
        return { ok: false, valid: false, error: 'LICENSE_NOT_FOUND', message: '유효하지 않은 라이선스 키입니다.' };
      }
      userId = lic.user_id;
      user = this.db.getUserById(userId);
    } else {
      return { ok: false, valid: false, error: 'MISSING_AUTH', message: '토큰 또는 라이선스 키가 필요합니다.' };
    }

    if (!user) {
      return { ok: false, valid: false, error: 'USER_NOT_FOUND', message: '등록된 사용자를 찾을 수 없습니다.' };
    }

    // HWID enforcement
    if (hwid && user.hwid && user.hwid !== hwid) {
      return {
        ok: false,
        valid: false,
        error: 'UNAUTHORIZED_DEVICE',
        message: '등록된 PC가 아닙니다.'
      };
    }

    const license = this.db.getLicenseByUserId(user.id);
    if (!license) {
      return { ok: false, valid: false, error: 'NO_LICENSE', message: '등록된 라이선스가 없습니다.' };
    }

    const daysLeft = this.calcDaysLeft(license.expires_at);
    const isValid = daysLeft > 0 && license.status === 'active';

    return {
      ok: true,
      valid: isValid,
      reason: isValid ? 'ACTIVE' : (daysLeft <= 0 ? 'EXPIRED' : 'SUSPENDED'),
      user: { id: user.id, email: user.email, name: user.name, hwid: user.hwid },
      license: {
        licenseKey: license.license_key,
        planType: license.plan_type,
        expiresAt: license.expires_at,
        daysLeft,
        isExpired: !isValid
      }
    };
  }

  heartbeat({ token, hwid = null, ip = '' }) {
    const verifyResult = this.verifyLicense({ token, hwid, ip });
    if (!verifyResult.ok || !verifyResult.valid) {
      return verifyResult;
    }

    const license = this.db.getLicenseByUserId(verifyResult.user.id);
    if (license) {
      this.db.updateLicenseHeartbeat(license.id, ip);
    }

    return {
      ok: true,
      valid: true,
      daysLeft: verifyResult.license.daysLeft,
      expiresAt: verifyResult.license.expiresAt
    };
  }

  activateLicenseKey({ token, licenseKey, hwid = null, ip = '' }) {
    if (!licenseKey) {
      return { ok: false, error: 'MISSING_KEY', message: '라이선스 키를 입력해주세요.' };
    }

    const jwtResult = verifyJwt(token, this.jwtSecret);
    const user = jwtResult.valid ? this.db.getUserById(jwtResult.payload.userId) : null;
    if (!user) {
      return { ok: false, error: 'LOGIN_REQUIRED', message: '라이선스를 활성화할 계정으로 먼저 로그인해주세요.' };
    }
    if (hwid && user.hwid && user.hwid !== hwid) {
      return { ok: false, error: 'UNAUTHORIZED_DEVICE', message: '등록된 PC가 아닙니다.' };
    }

    const found = this.findRedeemableVoucher(licenseKey);
    if (!found.ok) return found;
    const { voucher } = found;
    if (!this.db.redeemVoucher(voucher.id, user.id)) {
      return { ok: false, error: 'KEY_ALREADY_USED', message: '이미 사용된 라이선스 키입니다.' };
    }
    const license = this.grantDays(user.id, voucher.days, { orderId: voucher.order_id, channel: voucher.channel });

    this.db.logAudit({
      userId: user.id,
      action: 'ACTIVATE_KEY',
      details: `Key=${voucher.code}, +${voucher.days}d, newExpiresAt=${license.expires_at}`,
      ip
    });

    const daysLeft = this.calcDaysLeft(license.expires_at);
    return {
      ok: true,
      message: `정품 라이선스가 성공적으로 활성화되었습니다! (+${voucher.days}일 연장)`,
      license: {
        licenseKey: license.license_key,
        planType: license.plan_type,
        expiresAt: license.expires_at,
        daysLeft,
        isExpired: daysLeft <= 0
      }
    };
  }

  resetDevice({ email, password, newHwid, ip = '' }) {
    if (!email || !password || !newHwid) {
      return { ok: false, error: 'MISSING_PARAMS', message: '이메일, 비밀번호, 새 기기 식별값이 필요합니다.' };
    }

    const user = this.db.getUserByEmail(email);
    if (!user) {
      return { ok: false, error: 'USER_NOT_FOUND', message: '가입되지 않은 이메일입니다.' };
    }

    const passwordValid = verifyPassword(password, user.password_hash, user.password_salt);
    if (!passwordValid) {
      return { ok: false, error: 'INVALID_PASSWORD', message: '비밀번호가 일치하지 않습니다.' };
    }

    // Cooldown check (30 days between changes)
    if (user.hwid_changed_at) {
      const lastUpdate = new Date(user.hwid_changed_at).getTime();
      const elapsedDays = (Date.now() - lastUpdate) / (1000 * 60 * 60 * 24);
      if (elapsedDays < this.deviceResetCooldownDays) {
        const remainingDays = Math.ceil(this.deviceResetCooldownDays - elapsedDays);
        return {
          ok: false,
          error: 'DEVICE_RESET_COOLDOWN',
          message: `기기 변경은 30일에 1회만 가능합니다. (${remainingDays}일 후 변경 가능)`
        };
      }
    }

    this.db.changeUserHwid(user.id, newHwid);
    this.db.logAudit({
      userId: user.id,
      action: 'RESET_DEVICE',
      details: `Old HWID=${user.hwid}, New HWID=${newHwid}`,
      ip
    });

    return {
      ok: true,
      message: '새로운 기기로 바인딩이 완료되었습니다. 이제 이 PC에서 프로그램을 사용하실 수 있습니다.'
    };
  }

  async handleTossWebhook(payload, ip = '') {
    // Toss Payments Webhook payload
    // { eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId, status: 'DONE', ... } }
    // The body is only a hint: the payment is re-read from the Toss API with our secret key.
    const eventType = payload.eventType || payload.status || 'UNKNOWN';
    const data = payload.data || payload;
    const orderId = String(data.orderId || '').trim();

    this.db.logWebhook({
      provider: 'toss',
      eventType,
      orderId,
      amount: Number(data.totalAmount || data.amount || 0),
      rawPayload: payload
    });

    if (!this.tossSecretKey) {
      return { ok: false, status: 'NOT_CONFIGURED', message: 'TOSS_SECRET_KEY가 설정되지 않아 결제를 확인할 수 없습니다.' };
    }
    if (!orderId) {
      return { ok: false, status: 'INVALID', message: 'orderId가 없습니다.' };
    }

    let payment = null;
    try {
      payment = await this.tossFetchPayment(orderId);
    } catch {
      payment = null;
    }
    if (!payment || payment.orderId !== orderId) {
      return { ok: false, status: 'UNVERIFIED', message: '토스 결제 내역을 확인할 수 없습니다.' };
    }
    if (payment.status !== 'DONE') {
      return { ok: true, status: 'IGNORED', message: `Status is not DONE (${payment.status})` };
    }

    const amount = Number(payment.totalAmount || 0);
    const months = Math.floor(amount / this.monthlyPrice);
    if (months < 1) {
      return { ok: false, status: 'AMOUNT_MISMATCH', message: `결제 금액이 이용권 가격보다 적습니다. (${amount}원)` };
    }
    if (!this.db.markOrderProcessed('toss', orderId)) {
      return { ok: true, status: 'DUPLICATE', orderId, message: '이미 처리된 주문입니다.' };
    }

    const email = payment.customerEmail || payment.metadata?.email || data.customerEmail || data.email || '';
    return this.applyPurchase({ provider: 'toss', orderId, email, days: months * 30 });
  }

  // Paid days go straight onto an existing account; otherwise a one-time key is issued
  // for the buyer to enter at sign-up.
  applyPurchase({ provider, orderId, email, days }) {
    const user = email ? this.db.getUserByEmail(email) : null;
    if (user) {
      const license = this.grantDays(user.id, days, { orderId, channel: provider });
      this.db.logAudit({ userId: user.id, action: 'PURCHASE_APPLIED', details: `${provider} ${orderId} +${days}d` });
      const daysLeft = this.calcDaysLeft(license.expires_at);
      return {
        ok: true,
        status: 'PROCESSED',
        orderId,
        message: `구독 +${days}일이 계정에 반영되었습니다.`,
        user: { id: user.id, email: user.email },
        expiresAt: license.expires_at,
        license: {
          licenseKey: license.license_key,
          planType: license.plan_type,
          expiresAt: license.expires_at,
          daysLeft
        }
      };
    }

    const voucher = this.issueVoucher({ days, orderId, channel: provider });
    return {
      ok: true,
      status: 'VOUCHER_ISSUED',
      orderId,
      message: `가입된 계정이 없어 ${days}일 이용권 키를 발급했습니다. 구매자에게 키를 전달해주세요.`,
      licenseKey: voucher.code,
      days
    };
  }

  // ---- Seller admin (크몽 판매) ----
  adminSummary() {
    return { ok: true, summary: this.db.countSummary() };
  }

  adminIssueVouchers({ days, count = 1, memo = '', channel = 'kmong' } = {}) {
    const dayCount = Math.trunc(Number(days));
    const amount = Math.trunc(Number(count));
    if (!Number.isFinite(dayCount) || dayCount < 1 || dayCount > 730) {
      return { ok: false, error: 'INVALID_DAYS', message: '이용 기간은 1~730일 사이여야 합니다.' };
    }
    if (!Number.isFinite(amount) || amount < 1 || amount > 50) {
      return { ok: false, error: 'INVALID_COUNT', message: '한 번에 1~50개까지 발급할 수 있습니다.' };
    }
    const orderId = String(memo || '').trim().slice(0, 80) || null;
    const vouchers = Array.from({ length: amount }, () => this.issueVoucher({ days: dayCount, orderId, channel }));
    this.db.logAudit({ action: 'ADMIN_ISSUE_VOUCHER', details: `${amount} x ${dayCount}d ${orderId || ''}`.trim() });
    return { ok: true, vouchers };
  }

  adminListVouchers({ status = 'all' } = {}) {
    return { ok: true, vouchers: this.db.listVouchers({ status: ['unused', 'used'].includes(status) ? status : 'all' }) };
  }

  adminDeleteVoucher(id) {
    const removed = this.db.deleteUnusedVoucher(Number(id));
    if (!removed) return { ok: false, error: 'NOT_DELETABLE', message: '이미 사용됐거나 없는 이용권은 삭제할 수 없습니다.' };
    this.db.logAudit({ action: 'ADMIN_DELETE_VOUCHER', details: `voucher ${id}` });
    return { ok: true };
  }

  adminListUsers({ query = '' } = {}) {
    const users = this.db.listUsersWithLicenses({ query: String(query || '').trim().slice(0, 80) }).map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      hasDevice: Boolean(row.has_device),
      planType: row.plan_type || null,
      expiresAt: row.expires_at || null,
      daysLeft: row.expires_at ? this.calcDaysLeft(row.expires_at) : 0,
      lastSeenAt: row.last_heartbeat_at || null
    }));
    return { ok: true, users };
  }

  adminExtendUser(id, days) {
    const user = this.db.getUserById(Number(id));
    const dayCount = Math.trunc(Number(days));
    if (!user) return { ok: false, error: 'NOT_FOUND', message: '고객을 찾을 수 없습니다.' };
    if (!Number.isFinite(dayCount) || dayCount < 1 || dayCount > 730) {
      return { ok: false, error: 'INVALID_DAYS', message: '연장 기간은 1~730일 사이여야 합니다.' };
    }
    const license = this.grantDays(user.id, dayCount, { channel: 'admin' });
    this.db.logAudit({ userId: user.id, action: 'ADMIN_EXTEND', details: `+${dayCount}d` });
    return { ok: true, expiresAt: license.expires_at, daysLeft: this.calcDaysLeft(license.expires_at) };
  }

  adminResetDevice(id) {
    if (!this.db.clearUserHwid(Number(id))) return { ok: false, error: 'NOT_FOUND', message: '고객을 찾을 수 없습니다.' };
    this.db.logAudit({ userId: Number(id), action: 'ADMIN_RESET_DEVICE' });
    return { ok: true };
  }

  handleOrderSync({ provider = 'manual', orderId, email = '', months = 1, ip = '' }) {
    if (!orderId) {
      return { ok: false, error: 'MISSING_PARAMS', message: '주문번호가 필요합니다.' };
    }
    const monthCount = Math.trunc(Number(months));
    if (!Number.isFinite(monthCount) || monthCount < 1 || monthCount > 24) {
      return { ok: false, error: 'INVALID_MONTHS', message: '개월 수는 1~24 사이여야 합니다.' };
    }
    if (!this.db.markOrderProcessed(provider, String(orderId))) {
      return { ok: false, error: 'DUPLICATE_ORDER', message: '이미 처리된 주문번호입니다.' };
    }

    this.db.logWebhook({
      provider,
      eventType: 'ORDER_SYNC',
      orderId,
      amount: this.monthlyPrice * monthCount,
      rawPayload: { provider, orderId, email, months: monthCount, ip }
    });

    return this.applyPurchase({ provider, orderId: String(orderId), email, days: monthCount * 30 });
  }
}
