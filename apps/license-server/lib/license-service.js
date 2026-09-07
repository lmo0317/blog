import {
  hashPassword,
  verifyPassword,
  createJwt,
  verifyJwt,
  generateLicenseKey
} from './crypto-utils.js';

export class LicenseService {
  constructor(db, options = {}) {
    this.db = db;
    this.jwtSecret = options.jwtSecret || process.env.LICENSE_SERVER_SECRET || 'neighbor-mate-auth-secret-key-2026';
    this.defaultTrialDays = options.defaultTrialDays ?? 3;
    this.deviceResetCooldownDays = options.deviceResetCooldownDays ?? 30;
  }

  calcDaysLeft(expiresAtStr) {
    if (!expiresAtStr) return 0;
    const diff = new Date(expiresAtStr).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
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

    // Check licenseKey if supplied
    let existingLicense = null;
    if (licenseKey) {
      existingLicense = this.db.getLicenseByKey(licenseKey);
      if (existingLicense && existingLicense.user_id) {
        return { ok: false, error: 'LICENSE_ALREADY_CLAIMED', message: '이미 다른 사용자가 등록한 라이선스 키입니다.' };
      }
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
    const now = Date.now();
    if (existingLicense) {
      // Re-bind orphaned license to this new user
      const stmt = this.db.db.prepare('UPDATE licenses SET user_id = ? WHERE id = ?');
      stmt.run(user.id, existingLicense.id);
      license = this.db.getLicenseById(existingLicense.id);
    } else if (licenseKey) {
      // Initial 30-day license for given key
      const expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
      license = this.db.createLicense({
        userId: user.id,
        licenseKey,
        planType: 'monthly_paid',
        expiresAt,
        channel: 'direct_key'
      });
    } else {
      // Free trial license (e.g. 3 days)
      const expiresAt = new Date(now + this.defaultTrialDays * 24 * 60 * 60 * 1000).toISOString();
      const generatedKey = generateLicenseKey('MATE');
      license = this.db.createLicense({
        userId: user.id,
        licenseKey: generatedKey,
        planType: 'free_trial',
        expiresAt,
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

  activateLicenseKey({ email, licenseKey, hwid = null, ip = '' }) {
    if (!licenseKey) {
      return { ok: false, error: 'MISSING_KEY', message: '라이선스 키를 입력해주세요.' };
    }

    const cleanKey = licenseKey.trim().toUpperCase();
    let user = email ? this.db.getUserByEmail(email) : null;

    let license = this.db.getLicenseByKey(cleanKey);
    if (license && license.user_id) {
      // Key belongs to a user
      if (user && license.user_id !== user.id) {
        return { ok: false, error: 'KEY_ALREADY_USED', message: '이미 다른 사용자 계정에 귀속된 라이선스 키입니다.' };
      }
      user = user || this.db.getUserById(license.user_id);
      // Extend existing license by 30 days
      license = this.db.extendLicense(license.id, 30);
    } else if (license) {
      // Key exists but has no user yet
      if (!user) {
        return { ok: false, error: 'USER_REQUIRED', message: '라이선스를 귀속할 사용자 계정이 필요합니다.' };
      }
      const stmt = this.db.db.prepare('UPDATE licenses SET user_id = ? WHERE id = ?');
      stmt.run(user.id, license.id);
      license = this.db.extendLicense(license.id, 30);
    } else {
      // Key is new, format check
      if (!cleanKey.startsWith('MATE-') || cleanKey.length < 10) {
        return { ok: false, error: 'INVALID_KEY_FORMAT', message: '올바른 형식의 라이선스 키가 아닙니다. (예: MATE-XXXX-XXXX-XXXX)' };
      }
      if (!user) {
        return { ok: false, error: 'USER_REQUIRED', message: '라이선스를 활성화할 계정으로 로그인해주세요.' };
      }
      // Create new active 30-day license
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      license = this.db.createLicense({
        userId: user.id,
        licenseKey: cleanKey,
        planType: 'monthly_paid',
        expiresAt,
        channel: 'key_activation'
      });
    }

    this.db.logAudit({
      userId: user.id,
      action: 'ACTIVATE_KEY',
      details: `Key=${cleanKey}, newExpiresAt=${license.expires_at}`,
      ip
    });

    const daysLeft = this.calcDaysLeft(license.expires_at);
    return {
      ok: true,
      message: '정품 라이선스가 성공적으로 활성화되었습니다! (+30일 연장)',
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

  handleTossWebhook(payload, ip = '') {
    // Toss Payments Webhook payload
    // { eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId, status: 'DONE', totalAmount: 9900, customerEmail, ... } }
    const eventType = payload.eventType || payload.status || 'UNKNOWN';
    const data = payload.data || payload;
    const orderId = data.orderId || data.paymentKey || '';
    const status = data.status || '';
    const email = data.customerEmail || data.email || '';
    const amount = Number(data.totalAmount || data.amount || 0);

    this.db.logWebhook({
      provider: 'toss',
      eventType,
      orderId,
      amount,
      rawPayload: payload
    });

    if (status !== 'DONE' && eventType !== 'PAYMENT_CONFIRMED') {
      return { ok: true, status: 'IGNORED', message: `Status is not DONE (${status})` };
    }

    let user = email ? this.db.getUserByEmail(email) : null;
    let license = null;

    if (user) {
      license = this.db.getLicenseByUserId(user.id);
      if (license) {
        license = this.db.extendLicense(license.id, 30);
      } else {
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        license = this.db.createLicense({
          userId: user.id,
          licenseKey: generateLicenseKey('MATE'),
          planType: 'monthly_paid',
          expiresAt,
          orderId,
          channel: 'toss'
        });
      }
    } else {
      // If user not registered yet, create a pre-generated license with orderId
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const generatedKey = generateLicenseKey('MATE');
      // Create user placeholder or unassigned license
      const tempUser = this.db.createUser({
        email: email || `guest-${orderId}@neighbor-mate.local`,
        password_hash: 'PENDING_SETUP',
        password_salt: 'PENDING',
        name: '구독 구매자'
      });
      license = this.db.createLicense({
        userId: tempUser.id,
        licenseKey: generatedKey,
        planType: 'monthly_paid',
        expiresAt,
        orderId,
        channel: 'toss'
      });
    }

    return {
      ok: true,
      status: 'PROCESSED',
      orderId,
      expiresAt: license?.expires_at,
      licenseKey: license?.license_key
    };
  }

  handleOrderSync({ provider = 'manual', orderId, email, months = 1, ip = '' }) {
    if (!orderId || !email) {
      return { ok: false, error: 'MISSING_PARAMS', message: '주문번호와 구매자 이메일이 필요합니다.' };
    }

    let user = this.db.getUserByEmail(email);
    const addedDays = months * 30;

    let license;
    if (user) {
      license = this.db.getLicenseByUserId(user.id);
      if (license) {
        license = this.db.extendLicense(license.id, addedDays);
      } else {
        const expiresAt = new Date(Date.now() + addedDays * 24 * 60 * 60 * 1000).toISOString();
        license = this.db.createLicense({
          userId: user.id,
          licenseKey: generateLicenseKey('MATE'),
          planType: 'monthly_paid',
          expiresAt,
          orderId,
          channel: provider
        });
      }
    } else {
      const { hash, salt } = hashPassword('welcome1234!');
      user = this.db.createUser({
        email,
        password_hash: hash,
        password_salt: salt,
        name: email.split('@')[0]
      });
      const expiresAt = new Date(Date.now() + addedDays * 24 * 60 * 60 * 1000).toISOString();
      license = this.db.createLicense({
        userId: user.id,
        licenseKey: generateLicenseKey('MATE'),
        planType: 'monthly_paid',
        expiresAt,
        orderId,
        channel: provider
      });
    }

    this.db.logWebhook({
      provider,
      eventType: 'ORDER_SYNC',
      orderId,
      amount: 9900 * months,
      rawPayload: { provider, orderId, email, months }
    });

    const daysLeft = this.calcDaysLeft(license.expires_at);

    return {
      ok: true,
      message: `${months}개월 (+${addedDays}일) 구독이 자동 반영되었습니다.`,
      user: { id: user.id, email: user.email },
      license: {
        licenseKey: license.license_key,
        planType: license.plan_type,
        expiresAt: license.expires_at,
        daysLeft
      }
    };
  }
}
