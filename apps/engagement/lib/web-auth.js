// Password gate for the web build. The app drives the owner's Naver account, so once it is reachable from the
// internet (through the 112 server's hub) every request must come from someone who knows the password.
// Off unless APP_PASSWORD is set, so the desktop app is unaffected.
import crypto from 'node:crypto';

const MAX_AGE_SECONDS = 30 * 24 * 3600;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 20;

function loginPage({ title, error = '' }) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · 로그인</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.min.css">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;font-family:Pretendard,"Segoe UI",sans-serif;color:#0f172a;padding:16px}
form{width:100%;max-width:360px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:28px;box-shadow:0 4px 6px -1px rgba(0,0,0,.05),0 2px 4px -2px rgba(0,0,0,.05)}
.mark{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#03c75a,#00a94f);color:#fff;display:grid;place-items:center;font-weight:800}
h1{font-size:20px;margin:16px 0 6px}p{margin:0 0 18px;color:#64748b;font-size:13.5px}
input{width:100%;height:44px;padding:0 14px;border:1px solid #e2e8f0;border-radius:10px;font:inherit;font-size:15px;outline:none}
input:focus{border-color:#03c75a;box-shadow:0 0 0 3px rgba(3,199,90,.12)}
button{width:100%;height:44px;margin-top:12px;border:0;border-radius:10px;background:linear-gradient(135deg,#03c75a,#00a94f);color:#fff;font:inherit;font-weight:700;font-size:15px;cursor:pointer}
.error{margin-top:12px;color:#dc2626;font-size:13px}
</style></head><body>
<form method="post" action="login">
<div class="mark">N</div>
<h1>${title}</h1>
<p>비밀번호를 입력하면 이 기기에서 30일 동안 로그인이 유지됩니다.</p>
<input type="password" name="password" placeholder="비밀번호" autocomplete="current-password" autofocus required>
<button type="submit">들어가기</button>
${error ? `<div class="error">${error}</div>` : ''}
</form></body></html>`;
}

export function createWebAuth({ password = process.env.APP_PASSWORD || '', cookieName, title }) {
  if (!password) return null;
  const secret = crypto.createHash('sha256').update(`web-auth:${cookieName}:${password}`).digest();
  const token = crypto.createHmac('sha256', secret).update('authenticated').digest('base64url');
  const fails = [];

  const hasValidCookie = (req) => {
    const raw = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
    const value = raw ? raw.slice(cookieName.length + 1) : '';
    return value.length === token.length && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(token));
  };

  const passwordMatches = (candidate) => {
    const a = crypto.createHash('sha256').update(String(candidate || '')).digest();
    const b = crypto.createHash('sha256').update(password).digest();
    return crypto.timingSafeEqual(a, b);
  };

  return function webAuth(req, res, next) {
    if (req.path === '/login' && req.method === 'POST') {
      const now = Date.now();
      while (fails.length && now - fails[0] > FAIL_WINDOW_MS) fails.shift();
      if (fails.length >= MAX_FAILS) {
        res.status(429).type('html').send(loginPage({ title, error: '시도가 너무 많습니다. 10분 뒤에 다시 시도해 주세요.' }));
        return;
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        const candidate = new URLSearchParams(body).get('password');
        if (!passwordMatches(candidate)) {
          fails.push(Date.now());
          setTimeout(() => res.status(401).type('html').send(loginPage({ title, error: '비밀번호가 맞지 않습니다.' })), 800);
          return;
        }
        const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
        res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`);
        res.redirect(303, './');
      });
      return;
    }
    if (hasValidCookie(req)) return next();
    if (req.method === 'GET' && (req.path === '/' || req.path === '/login' || String(req.headers.accept || '').includes('text/html'))) {
      res.status(401).type('html').send(loginPage({ title }));
      return;
    }
    res.status(401).json({ error: '로그인이 필요합니다. 페이지를 새로고침해 비밀번호를 입력해 주세요.' });
  };
}
