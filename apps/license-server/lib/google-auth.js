// "Google로 시작하기": the app opens /api/auth/google/start?state=… in the customer's browser. The page
// keeps the state in a cookie and shows Google's button; Google sends the browser back to /callback with an
// ID token (redirect mode, same tab: no popup to be blocked), and the app polls /poll with the same state
// to get logged in. No client secret: an ID token is checked against Google's tokeninfo endpoint, and only
// its verified email is used.
import crypto from 'node:crypto';

// Public by design (it is in every sign-in page); the Google Cloud project is "NeighborMate".
export const GOOGLE_CLIENT_ID = '989250360474-ms1llj903s5d2svijepk24iatdjt4pc0.apps.googleusercontent.com';
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const STATE_RE = /^[a-f0-9]{32,64}$/;
const PENDING_MS = 10 * 60 * 1000;

export class GoogleAuth {
  constructor({ clientId = process.env.GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID, fetchFn = globalThis.fetch, now = () => Date.now() } = {}) {
    this.clientId = clientId;
    this.fetchFn = fetchFn;
    this.now = now;
    this.pending = new Map(); // state -> { email, name, at }
  }

  static newState() {
    return crypto.randomBytes(16).toString('hex');
  }

  isState(state) {
    return typeof state === 'string' && STATE_RE.test(state);
  }

  async verifyIdToken(credential) {
    if (typeof credential !== 'string' || credential.length < 20 || credential.length > 4096) return null;
    let info;
    try {
      const res = await this.fetchFn(`${TOKENINFO_URL}?id_token=${encodeURIComponent(credential)}`);
      if (!res.ok) return null;
      info = await res.json();
    } catch {
      return null;
    }
    const issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
    const fresh = Number(info.exp) * 1000 > this.now();
    const verified = info.email_verified === true || info.email_verified === 'true';
    if (info.aud !== this.clientId || !issuerOk || !fresh || !verified || !info.email) return null;
    return { email: String(info.email).toLowerCase(), name: info.name || '' };
  }

  async complete({ state, credential }) {
    if (!this.isState(state)) return { ok: false, error: 'INVALID_STATE', message: '앱에서 다시 시작해 주세요.' };
    const who = await this.verifyIdToken(credential);
    if (!who) return { ok: false, error: 'GOOGLE_VERIFY_FAILED', message: '구글 계정을 확인하지 못했습니다. 다시 시도해 주세요.' };
    this.sweep();
    this.pending.set(state, { ...who, at: this.now() });
    return { ok: true, email: who.email };
  }

  // One use: the app that started this state takes the verified account.
  take(state) {
    if (!this.isState(state)) return null;
    this.sweep();
    const entry = this.pending.get(state);
    if (!entry) return null;
    this.pending.delete(state);
    return entry;
  }

  sweep() {
    const cutoff = this.now() - PENDING_MS;
    for (const [state, entry] of this.pending) if (entry.at < cutoff) this.pending.delete(state);
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const STATE_COOKIE = 'nm_gstate';

export function googleDonePage({ ok, email = '', message = '' }) {
  const body = ok
    ? `<div class="big">✅</div><h1>로그인되었습니다</h1><p class="lead"><b>${esc(email)}</b><br>이 창을 닫고 이웃메이트 앱으로 돌아가세요.<br>앱이 몇 초 안에 자동으로 시작됩니다.</p>`
    : `<div class="big">⚠️</div><h1>로그인하지 못했습니다</h1><p class="lead">${esc(message)}<br>이웃메이트 앱에서 [Google로 3일 무료 체험 시작]을 다시 눌러 주세요.</p>`;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>이웃메이트 - ${ok ? '로그인 완료' : '로그인 실패'}</title>
<style>${PAGE_CSS}</style></head>
<body><main class="card">${body}</main></body></html>`;
}

const PAGE_CSS = `
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-family:'Pretendard','Malgun Gothic',system-ui,sans-serif;color:#0f172a}
  .card{width:min(420px,calc(100% - 32px));background:#fff;border-radius:18px;box-shadow:0 10px 30px rgba(15,23,42,.08);padding:32px 28px;text-align:center}
  h1{font-size:22px;margin:0 0 8px}
  .lead{color:#475569;font-size:15px;margin:0 0 24px;line-height:1.6}
  #btn{display:flex;justify-content:center;min-height:44px}
  .terms{font-size:12px;color:#64748b;margin-top:18px;line-height:1.6}
  .terms a{color:#4f46e5}
  .big{font-size:44px;margin-bottom:8px}
  .err{color:#dc2626;font-size:14px;margin-top:14px;min-height:1em}`;

export function googleStartPage({ clientId, loginUri, termsUrl, privacyUrl }) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>이웃메이트 - Google로 시작하기</title>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<style>${PAGE_CSS}</style></head>
<body><main class="card">
  <h1>🤝 이웃메이트 3일 무료 체험</h1>
  <p class="lead">구글 계정을 고르면 바로 시작됩니다.<br>처음이면 3일 무료 체험이, 가입했다면 로그인이 됩니다.</p>
  <div id="g_id_onload" data-client_id="${esc(clientId)}" data-ux_mode="redirect" data-login_uri="${esc(loginUri)}" data-auto_prompt="false"></div>
  <div id="btn" class="g_id_signin" data-type="standard" data-theme="outline" data-size="large" data-text="continue_with" data-shape="pill" data-locale="ko" data-width="300"></div>
  <p class="err" id="err"></p>
  <p class="terms">구글에서는 이메일 주소와 이름만 받습니다.<br>처음 한 번, 앱에서 <a href="${esc(termsUrl)}" target="_blank" rel="noopener">이용약관</a>과 <a href="${esc(privacyUrl)}" target="_blank" rel="noopener">개인정보 처리방침</a> 동의를 체크합니다.</p>
</main>
<script>
  window.addEventListener('load', () => setTimeout(() => {
    if (!window.google) document.getElementById('err').textContent = '구글 로그인 버튼을 불러오지 못했습니다. 새로고침해 주세요.';
  }, 4000));
</script>
</body></html>`;
}
