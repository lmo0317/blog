import { chromium } from 'playwright';
import { chmod, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path, { dirname } from 'node:path';

const BLOG_ID_PATTERN = /^[a-zA-Z0-9_.-]{2,50}$/;

export function normalizeBlogItem(item) {
  const link = String(item?.bloggerlink || item?.link || '').trim();
  const blogId = extractBlogId(link);
  return {
    blogId,
    title: stripTags(item?.title),
    description: stripTags(item?.description),
    bloggerName: stripTags(item?.bloggername),
    link,
    postDate: String(item?.postdate || '')
  };
}

export function extractBlogId(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)blog\.naver\.com$/i.test(url.hostname)) return '';
    const first = url.pathname.split('/').filter(Boolean)[0] || '';
    if (/\.(naver|nhn)$/i.test(first)) return '';
    return BLOG_ID_PATTERN.test(first) ? first : '';
  } catch {
    return '';
  }
}

export function classifyLoginPage({ authenticated = false, text = '' } = {}) {
  if (authenticated) return { status: 'connected', message: '' };
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (/자동입력 방지|캡차|보안 문자/i.test(normalized)) {
    return { status: 'user_action', reason: 'captcha', message: '열린 네이버 창에서 자동입력 방지 문자를 입력해주세요.' };
  }
  if (/2단계|새로운 환경|기기 등록|추가 인증|보안 확인|본인 확인/i.test(normalized)) {
    return { status: 'user_action', reason: 'verification', message: '열린 네이버 창에서 추가 인증을 완료해주세요.' };
  }
  if (/아이디 또는 비밀번호|비밀번호가 일치하지|아이디를 잘못 입력/i.test(normalized)) {
    return { status: 'invalid_credentials', reason: 'credentials', message: '네이버가 아이디 또는 비밀번호 오류를 반환했습니다.' };
  }
  return {
    status: 'user_action',
    reason: 'not_authenticated',
    message: '네이버 로그인이 아직 완료되지 않았습니다. 열린 창에서 로그인한 뒤 연결 상태를 확인해주세요.'
  };
}

export function normalizeWebSearchLinks(records = []) {
  const blogs = new Map();
  for (const record of records) {
    const blogId = extractBlogId(record?.href);
    if (!blogId) continue;
    const text = stripTags(record?.text).replace(/새 창 열림/g, '').trim();
    const pathname = new URL(record.href).pathname.split('/').filter(Boolean);
    const current = blogs.get(blogId) || {
      blogId,
      title: '',
      description: '',
      bloggerName: '',
      link: `https://blog.naver.com/${blogId}`,
      postDate: ''
    };

    if (pathname.length === 1 && text && text.length <= 80) {
      current.bloggerName ||= text;
    } else if (pathname.length >= 2 && text.length >= 4) {
      if (!current.title) {
        current.title = text.slice(0, 140);
        current.link = record.href;
      } else if (!current.description && text !== current.title && text.length > 20) {
        current.description = text.slice(0, 220);
      }
    }
    blogs.set(blogId, current);
  }
  return [...blogs.values()];
}

export function parseRelativePostDate(dateStr = '') {
  const str = String(dateStr).trim();
  if (!str) return null;
  const now = new Date();
  if (/방금|분\s*전|초\s*전/i.test(str)) {
    return now;
  }
  const hoursMatch = str.match(/(\d+)\s*시간\s*전/i);
  if (hoursMatch) {
    return new Date(now.getTime() - parseInt(hoursMatch[1], 10) * 3600 * 1000);
  }
  if (/어제/i.test(str)) {
    return new Date(now.getTime() - 24 * 3600 * 1000);
  }
  if (/그저께|그제/i.test(str)) {
    return new Date(now.getTime() - 48 * 3600 * 1000);
  }
  const daysMatch = str.match(/(\d+)\s*일\s*전/i);
  if (daysMatch) {
    return new Date(now.getTime() - parseInt(daysMatch[1], 10) * 24 * 3600 * 1000);
  }
  const weeksMatch = str.match(/(\d+)\s*주\s*전/i);
  if (weeksMatch) {
    return new Date(now.getTime() - parseInt(weeksMatch[1], 10) * 7 * 24 * 3600 * 1000);
  }
  const monthsMatch = str.match(/(\d+)\s*(달|개월)\s*전/i);
  if (monthsMatch) {
    return new Date(now.getTime() - parseInt(monthsMatch[1], 10) * 30 * 24 * 3600 * 1000);
  }
  const cleanDateStr = str.replace(/[.\s]+$/, '').replace(/\./g, '-');
  const parsed = new Date(cleanDateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }
  return null;
}

export function isPostActiveWithinDays(dateStr = '', days = 0) {
  if (!days || Number(days) <= 0) return true;
  const date = parseRelativePostDate(dateStr);
  if (!date) return true;
  const diffDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= Number(days);
}

export function classifyNeighborResult(text = '', pageClosed = false) {
  if (pageClosed) return { status: 'added', message: '이웃 추가가 완료되었습니다.' };
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (/하루에 신청할 수 있는|1일.*(초과|제한|한도)|신청 가능 횟수.*초과|더 이상.*신청할 수 없.*(하루|일일)|오늘.*신청/i.test(normalized)) {
    return { status: 'limit_reached', message: '네이버 일일 서로이웃 신청 한도(100명)에 도달했습니다.' };
  }
  if (/현재 서로이웃입니다|이미 서로이웃/i.test(normalized)) {
    return { status: 'already_mutual', message: '이미 서로이웃인 블로그입니다.' };
  }
  if (/서로이웃 신청\s*(중|진행중)|서로이웃 신청.*(완료|보냈|했습니다)|신청한 서로이웃/i.test(normalized)) {
    return { status: 'requested', message: '서로이웃 신청이 완료되었습니다.' };
  }
  if (/이미 (서로)?이웃|이미 추가된 이웃|이미 추가한 이웃|이미 이웃으로|현재 (서로)?이웃입니다/i.test(normalized)) {
    return { status: 'already_added', message: '이미 이웃인 블로그입니다.' };
  }
  if (/자신의 블로그|내 블로그는 이웃/i.test(normalized)) {
    return { status: 'self', message: '내 블로그는 추가할 수 없습니다.' };
  }
  if (/이웃으로 추가되었습니다|이웃 추가가 완료|이웃으로 추가했/i.test(normalized)) {
    return { status: 'added', message: '이웃 추가가 완료되었습니다.' };
  }
  if (/자동입력 방지|보안 확인|추가 인증|로그인이 필요/i.test(normalized)) {
    return { status: 'verification_required', message: '네이버 보안 확인이 필요합니다.' };
  }
  if (/이웃 추가를 허용하지|더 이상 이웃|이웃\s*수.*초과|서로이웃을 더 맺을 수 없|존재하지 않거나 잘못 설치된 이웃커넥트|서로이웃을 받지 않는/i.test(normalized)) {
    return { status: 'unavailable', message: '이 블로그는 현재 이웃으로 추가할 수 없습니다.' };
  }
  return { status: 'unknown', message: '네이버 응답을 확인하지 못했습니다.' };
}


export function classifyPublishResult({ url = '', text = '' } = {}) {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (/nidlogin\.login/i.test(url) || /로그인이 필요|추가 인증|보안 확인/i.test(normalized)) {
    return { status: 'verification_required', message: '네이버 로그인 또는 보안 확인이 필요합니다.' };
  }
  if (
    /PostView\.naver|[?&]logNo=\d+|\/\d{9,}/i.test(url) ||
    /blog\.naver\.com\/[a-zA-Z0-9_-]+\/\d+/i.test(url) ||
    !url.includes('PostWriteForm')
  ) {
    return { status: 'published', message: '블로그 글이 성공적으로 발행되었습니다!' };
  }
  return { status: 'manual_required', message: '글 발행 상태를 확인해주세요.' };
}

export function isNaverLoginUrl(url = '') {
  try {
    const parsed = new URL(String(url));
    return parsed.hostname.toLowerCase() === 'nid.naver.com' && /\/nidlogin\.login$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function stripTags(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export class NaverSearchClient {
  constructor({ clientId, clientSecret, fetchImpl = fetch }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetchImpl = fetchImpl;
  }

  async search({ query, display = 30, sort = 'date' }) {
    if (!this.clientId || !this.clientSecret) {
      const error = new Error('NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET을 .env 또는 환경 변수에 설정해주세요.');
      error.code = 'NAVER_API_NOT_CONFIGURED';
      throw error;
    }
    const params = new URLSearchParams({
      query,
      display: String(Math.min(Math.max(Number(display) || 30, 1), 100)),
      start: '1',
      sort: sort === 'sim' ? 'sim' : 'date'
    });
    const response = await this.fetchImpl(`https://openapi.naver.com/v1/search/blog.json?${params}`, {
      headers: {
        'X-Naver-Client-Id': this.clientId,
        'X-Naver-Client-Secret': this.clientSecret
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.errorMessage || `네이버 검색 API 오류 (${response.status})`);
    }

    const seen = new Set();
    return (body.items || [])
      .map(normalizeBlogItem)
      .filter((item) => item.blogId && !seen.has(item.blogId) && seen.add(item.blogId));
  }
}

async function cleanProfileLocks(profileDir) {
  if (!profileDir) return;
  const targetDirs = [profileDir, path.join(profileDir, 'Default')];
  for (const dir of targetDirs) {
    try {
      const files = await readdir(dir);
      for (const f of files) {
        if (f.toLowerCase().includes('lock') || f.toLowerCase().includes('singleton')) {
          await rm(path.join(dir, f), { force: true, recursive: true }).catch(() => {});
        }
      }
    } catch {}
  }
}

export class NaverBrowserSession {
  constructor({ headless = false, browserFactory = chromium, profileDir = '', sessionStatePath = '' }) {
    this.headless = headless;
    this.browserFactory = browserFactory;
    this.profileDir = profileDir;
    this.sessionStatePath = sessionStatePath;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.connectedId = '';
    this.pendingPostUpdate = null;
  }

  get connected() {
    if (!this.context || !this.connectedId) return false;
    if (this.browser) return this.browser.isConnected();
    return this.context.pages().length > 0;
  }

  async login({ id, password }) {
    try {
      if (this.connected) return { connected: true, accountLabel: maskId(this.connectedId), restored: true };
      const existingSession = await this.openLoginPage();
      if (existingSession.connected) return existingSession;

      // Fill credentials with real input events
      await this.page.locator('#id').fill(id);
      await this.page.waitForTimeout(100);
      await this.page.locator('#pw').fill(password);
      await this.page.waitForTimeout(200);

      const submitBtn = this.page.locator('#loginBtn_row, #loginBtn_column, .btn_login, #log\\.login, button.btn_done').first();
      await submitBtn.click({ timeout: 5000 }).catch(() => {});

      const authenticated = await this.waitForAuthentication(5000);
      const pageText = await this.readLoginFeedback();
      const state = classifyLoginPage({ authenticated, text: pageText });
      if (state.status !== 'connected') {
        await this.page.bringToFront().catch(() => {});
        return {
          connected: false,
          needsUserAction: true,
          reason: state.reason || 'security_check',
          message: state.message || '네이버 보안 인증(자동입력 방지/2단계 인증)이 필요합니다. 열린 브라우저 창에서 로그인을 완료해주세요.'
        };
      }

      this.connectedId = id;
      await this.saveSessionState();
      return { connected: true, accountLabel: maskId(id) };
    } finally {
      password = '';
      id = '';
    }
  }

  async getQrCode() {
    if (this.connected && await this.hasAuthenticatedCookies()) {
      return { connected: true, accountLabel: '네이버 로그인됨' };
    }
    if (!this.context || !this.page || this.page.isClosed()) {
      await this.launchBrowserContext();
    }
    await this.page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    await this.page.click('#qrcode_login');
    await this.page.waitForSelector('#qrImage', { timeout: 10000 });
    const qrImage = await this.page.locator('#qrImage').getAttribute('src');
    return { connected: false, qrImage };
  }

  async checkQrLoginStatus() {
    if (!this.context) return { connected: false };
    const hasCookies = await this.hasAuthenticatedCookies();
    if (hasCookies) {
      this.connectedId = 'qr-session';
      await this.saveSessionState();
      return { connected: true, accountLabel: '네이버 로그인됨' };
    }
    return { connected: false };
  }

  async setSessionCookies({ nidAut = '', nidSes = '' } = {}) {
    const aut = String(nidAut || '').trim();
    const ses = String(nidSes || '').trim();
    if (!aut || !ses) throw new Error('NID_AUT와 NID_SES 쿠키 값을 모두 입력해주세요.');

    if (!this.context || !this.page || this.page.isClosed()) {
      await this.launchBrowserContext();
    }

    await this.context.addCookies([
      { name: 'NID_AUT', value: aut, domain: '.naver.com', path: '/' },
      { name: 'NID_SES', value: ses, domain: '.naver.com', path: '/' }
    ]);

    const authenticated = await this.hasAuthenticatedSession();
    if (!authenticated) {
      throw new Error('유효하지 않거나 만료된 네이버 쿠키 값입니다. 다시 확인해주세요.');
    }

    this.connectedId = 'cookie-session';
    await this.saveSessionState();
    return { connected: true, accountLabel: '네이버 로그인됨' };
  }

  async openLoginPage() {
    if (this.connected && await this.hasAuthenticatedCookies()) {
      const accountLabel = this.connectedId === 'saved-session' ? '네이버 로그인됨' : maskId(this.connectedId);
      return { connected: true, accountLabel, restored: true };
    }

    if (!this.context || !this.page || this.page.isClosed()) {
      await this.launchBrowserContext();
    }

    if (await this.hasAuthenticatedCookies()) {
      this.connectedId = 'saved-session';
      await this.saveSessionState();
      return { connected: true, accountLabel: '네이버 로그인됨', restored: true };
    }

    await this.page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await this.page.bringToFront().catch(() => {});
    return {
      connected: false,
      needsUserAction: true,
      reason: 'manual_login',
      message: '열린 네이버 창에서 로그인한 뒤 연결 상태 확인을 눌러주세요.'
    };
  }

  async launchBrowserContext() {
    if (this.context && this.page && !this.page.isClosed()) {
      return;
    }

    const baseArgs = [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized',
      '--lang=ko-KR'
    ];

    const launchOptions = {
      headless: this.headless,
      channel: 'chrome',
      args: baseArgs,
      ignoreDefaultArgs: ['--enable-automation']
    };

    let contextOptions = {
      locale: 'ko-KR',
      viewport: null,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    };

    if (this.sessionStatePath && existsSync(this.sessionStatePath)) {
      contextOptions.storageState = this.sessionStatePath;
    }

    try {
      this.browser = await this.browserFactory.launch(launchOptions);
      this.context = await this.browser.newContext(contextOptions);
    } catch {
      delete launchOptions.channel;
      this.browser = await this.browserFactory.launch(launchOptions);
      this.context = await this.browser.newContext(contextOptions);
    }

    this.page = await this.context.newPage();

    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      delete Object.getPrototypeOf(navigator).webdriver;
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
    });

    await this.loadSessionState();
  }

  async restoreSession() {
    if (!this.sessionStatePath || !existsSync(this.sessionStatePath)) {
      this.connectedId = '';
      return { connected: false };
    }
    if (!this.context || !this.page || this.page.isClosed()) {
      await this.launchBrowserContext();
    }
    const hasCookies = await this.hasAuthenticatedCookies();
    if (!hasCookies) {
      this.connectedId = '';
      return { connected: false };
    }

    const isValid = await this.hasAuthenticatedSession();
    if (!isValid) {
      this.connectedId = '';
      try {
        if (this.sessionStatePath && existsSync(this.sessionStatePath)) {
          await rm(this.sessionStatePath, { force: true }).catch(() => {});
        }
      } catch {}
      return { connected: false, message: '저장된 세션이 만료되었습니다. 다시 로그인해주세요.' };
    }

    this.connectedId = 'saved-session';
    return { connected: true, accountLabel: '네이버 로그인됨', restored: true };
  }

  async checkConnection() {
    if (this.connected && await this.hasAuthenticatedSession()) {
      return { connected: true, accountLabel: '네이버 로그인됨' };
    }
    return await this.restoreSession();
  }

  async hasAuthenticatedCookies() {
    if (!this.context) return false;
    try {
      const cookies = await this.context.cookies();
      const names = new Set(cookies.map((cookie) => cookie.name));
      return names.has('NID_AUT') && names.has('NID_SES');
    } catch {
      return false;
    }
  }

  async hasAuthenticatedSession() {
    if (!await this.hasAuthenticatedCookies()) return false;
    try {
      if (!this.context) return false;
      const verifyPage = await this.context.newPage();
      try {
        await verifyPage.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded', timeout: 10000 });
        const curUrl = verifyPage.url();
        if (curUrl.includes('nidlogin.login')) {
          return false;
        }
        return true;
      } finally {
        await verifyPage.close().catch(() => {});
      }
    } catch {
      return false;
    }
  }

  async close() {
    try {
      if (this.context) {
        await this.context.close().catch(() => {});
        this.context = null;
        this.page = null;
      }
      if (this.browser?.isConnected()) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
      this.connectedId = '';
    } catch {}
  }

  async loginWithCredentials(username, password) {
    if (!username || !password) {
      throw new Error('네이버 아이디와 비밀번호를 입력해주세요.');
    }

    if (!this.context || !this.page || this.page.isClosed()) {
      await this.launchBrowserContext();
    }

    const page = this.page;
    await page.goto('https://nid.naver.com/nidlogin.login?mode=form', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    // Focus and type ID
    const idInput = page.locator('#id');
    await idInput.click({ force: true });
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(String(username).trim());
    await page.waitForTimeout(150);

    // Focus and type PW
    const pwInput = page.locator('#pw');
    await pwInput.click({ force: true });
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(String(password));
    await page.waitForTimeout(200);

    // Check "로그인 상태 유지" (keep login state)
    const keepCheckbox = page.locator('#loginStay, #keep, label[for="loginStay"], label[for="keep"]').first();
    if (await keepCheckbox.count() > 0) {
      await keepCheckbox.click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(200);

    // Click Login button (supports updated Naver login UI #loginBtn_row / #loginBtn_column)
    const loginBtn = page.locator('#loginBtn_row, #loginBtn_column, button.btn_done:has-text("로그인"), #log\\.login, button.btn_login').first();
    if (await loginBtn.count() > 0) {
      await loginBtn.click({ force: true }).catch(() => {});
    }
    await page.evaluate(() => {
      const btn = document.querySelector('#loginBtn_row') || document.querySelector('#loginBtn_column') || document.querySelector('#log\\.login');
      if (btn) btn.click();
    }).catch(() => {});
    
    const startTime = Date.now();
    const timeoutMs = 25000;
    
    while (Date.now() - startTime < timeoutMs) {
      await page.waitForTimeout(1000);
      const url = page.url();
      
      if (!url.includes('nidlogin.login') && (url.includes('naver.com') || url.includes('blog.naver.com'))) {
        await this.saveSessionState();
        this.connectedId = username;
        return {
          connected: true,
          accountLabel: maskId(username),
          message: '네이버 로그인이 성공적으로 완료되었습니다!'
        };
      }

      const errLocator = page.locator('#err_common, .error_message, .error_text');
      if (await errLocator.count() > 0 && await errLocator.first().isVisible().catch(() => false)) {
        const errText = await errLocator.first().innerText().catch(() => '');
        if (errText.trim()) {
          return {
            connected: false,
            message: `로그인 실패: ${errText.trim()}`
          };
        }
      }

      const deviceRegBtn = page.locator('#new\\.dontsave, #new\\.save, button:has-text("등록 안 함"), button:has-text("등록")').first();
      if (await deviceRegBtn.count() > 0 && await deviceRegBtn.isVisible().catch(() => false)) {
        await deviceRegBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    }

    if (await this.hasAuthenticatedCookies()) {
      await this.saveSessionState();
      this.connectedId = username;
      return {
        connected: true,
        accountLabel: maskId(username),
        message: '네이버 로그인이 완료되었습니다.'
      };
    }

    return {
      connected: false,
      message: '로그인에 실패했거나 2단계 인증/보안 확인이 필요합니다. 아이디와 비밀번호를 다시 확인해주세요.'
    };
  }

  async loadSessionState() {
    if (!this.sessionStatePath || !this.context) return false;
    try {
      const state = JSON.parse(await readFile(this.sessionStatePath, 'utf8'));
      if (!Array.isArray(state.cookies) || !state.cookies.length) return false;
      await this.context.addCookies(state.cookies);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async saveSessionState() {
    if (!this.sessionStatePath || !this.context || !await this.hasAuthenticatedCookies()) return false;
    try {
      const state = await this.context.storageState();
      await mkdir(dirname(this.sessionStatePath), { recursive: true });
      await writeFile(this.sessionStatePath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
      await chmod(this.sessionStatePath, 0o600).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  async openLoginWindow() {
    let interactiveBrowser = null;
    let interactiveContext = null;
    try {
      interactiveBrowser = await this.browserFactory.launch({
        headless: false,
        channel: 'chrome',
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--start-maximized',
          '--new-window'
        ]
      }).catch(async () => {
        return await this.browserFactory.launch({
          headless: false,
          args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--start-maximized',
            '--new-window'
          ]
        });
      });

      interactiveContext = await interactiveBrowser.newContext({
        locale: 'ko-KR',
        viewport: null
      });

      const loginPage = await interactiveContext.newPage();
      await loginPage.goto('https://nid.naver.com/nidlogin.login?mode=form', { waitUntil: 'domcontentloaded' });
      await loginPage.bringToFront();

      const maxWaitMs = 180000;
      const startTime = Date.now();
      let loggedIn = false;

      // Initial grace period for page to render
      await new Promise((r) => setTimeout(r, 3000));

      while (Date.now() - startTime < maxWaitMs) {
        if (loginPage.isClosed()) {
          const cookies = await interactiveContext.cookies().catch(() => []);
          const cookieNames = new Set(cookies.map((c) => c.name));
          if (cookieNames.has('NID_AUT') && cookieNames.has('NID_SES')) {
            loggedIn = true;
          }
          break;
        }

        const url = loginPage.url();
        const cookies = await interactiveContext.cookies().catch(() => []);
        const cookieNames = new Set(cookies.map((c) => c.name));

        const isNotOnLoginPage = !url.includes('nidlogin.login');
        const hasCookies = cookieNames.has('NID_AUT') && cookieNames.has('NID_SES');

        if (isNotOnLoginPage && hasCookies) {
          loggedIn = true;
          await new Promise((r) => setTimeout(r, 1500));
          break;
        }

        await new Promise((r) => setTimeout(r, 1000));
      }

      if (loggedIn) {
        const state = await interactiveContext.storageState();
        if (this.sessionStatePath) {
          await mkdir(dirname(this.sessionStatePath), { recursive: true });
          await writeFile(this.sessionStatePath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
        }
        if (!this.context || !this.page || this.page.isClosed()) {
          await this.launchBrowserContext();
        } else {
          await this.context.addCookies(state.cookies);
        }
        this.connectedId = 'browser-login';
        return { success: true, message: '네이버 로그인이 완료되어 세션이 영구 저장되었습니다.' };
      }

      return { success: false, message: '로그인이 완료되지 않았거나 창이 닫혔습니다.' };
    } finally {
      if (interactiveContext) await interactiveContext.close().catch(() => {});
      if (interactiveBrowser?.isConnected()) await interactiveBrowser.close().catch(() => {});
    }
  }

  async injectCookies(nidAut, nidSes) {
    if (!nidAut || !nidSes) throw new Error('NID_AUT와 NID_SES 값이 필요합니다.');
    const cookies = [
      { name: 'NID_AUT', value: String(nidAut).trim(), domain: '.naver.com', path: '/' },
      { name: 'NID_SES', value: String(nidSes).trim(), domain: '.naver.com', path: '/' }
    ];
    if (this.sessionStatePath) {
      await mkdir(dirname(this.sessionStatePath), { recursive: true });
      await writeFile(this.sessionStatePath, JSON.stringify({ cookies, origins: [] }), { encoding: 'utf8', mode: 0o600 });
    }
    if (!this.context || !this.page || this.page.isClosed()) {
      await this.launchBrowserContext();
    } else {
      await this.context.addCookies(cookies);
    }
    this.connectedId = 'cookie-injected';
    return { success: true, message: '쿠키가 성공적으로 등록되었습니다.' };
  }

  async keepAlive() {
    if (!this.context) return;
    try {
      const pingPage = await this.context.newPage();
      await pingPage.goto('https://blog.naver.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await this.saveSessionState().catch(() => {});
      await pingPage.close().catch(() => {});
    } catch {
      // Ignore keep-alive errors
    }
  }

  async openNeighborForm(blogId) {
    if (!this.connected) throw new Error('먼저 네이버 계정을 연결해주세요.');
    if (!BLOG_ID_PATTERN.test(blogId)) throw new Error('올바른 블로그 ID가 아닙니다.');

    const page = await this.context.newPage();
    await page.goto(`https://section.blog.naver.com/connect/PopConnectBuddyAddForm.naver?blogId=${encodeURIComponent(blogId)}`, {
      waitUntil: 'domcontentloaded'
    });
    await page.bringToFront();
    return { blogId, url: page.url(), status: 'awaiting_user_confirmation' };
  }

  async addNeighbor(blogId, mutualMessage = '안녕하세요! 블로그 글 유익하게 보고 갑니다. 서로이웃 맺고 소통해요 :)', bloggerName = '') {
    if (!this.connected) throw new Error('먼저 네이버 계정을 연결해주세요.');
    if (!BLOG_ID_PATTERN.test(blogId)) throw new Error('올바른 블로그 ID가 아닙니다.');

    const nameToUse = String(bloggerName || '').trim() || '블로거';
    const finalMessage = String(mutualMessage || '안녕하세요! 블로그 글 유익하게 보고 갑니다. 서로이웃 맺고 소통해요 :)')
      .replace(/(\(nickname\)|\{nickname\}|\{name\}|\(닉네임\)|\{닉네임\})/gi, nameToUse);

    const page = await this.context.newPage();
    let popup = null;
    try {
      await page.goto(`https://blog.naver.com/${encodeURIComponent(blogId)}`, {
        waitUntil: 'domcontentloaded'
      });
      await page.waitForTimeout(900);
      if (/nidlogin\.login/i.test(page.url())) {
        await page.bringToFront();
        return { blogId, bloggerName: nameToUse, status: 'verification_required', message: '로그인 또는 보안 확인이 필요합니다.' };
      }

      const profileFrame = page.frames().find((frame) => /\/(prologue\/PrologueList|PostView|PostList)\.naver/i.test(frame.url()));
      const trigger = profileFrame?.locator('a._addBuddyPop');
      if (!trigger || await trigger.count() !== 1 || !await trigger.isVisible().catch(() => false)) {
        const checkPage = await this.context.newPage();
        try {
          await checkPage.goto(`https://section.blog.naver.com/connect/PopConnectBuddyAddForm.naver?blogId=${encodeURIComponent(blogId)}`, {
            waitUntil: 'domcontentloaded'
          });
          const known = classifyNeighborResult(await checkPage.locator('body').innerText().catch(() => ''));
          if (known.status !== 'unknown') return { blogId, bloggerName: nameToUse, ...known };
        } finally {
          await checkPage.close().catch(() => {});
        }
        await page.bringToFront();
        return { blogId, bloggerName: nameToUse, status: 'manual_required', message: '표준 이웃추가 버튼을 찾지 못했습니다.' };
      }

      const popupPromise = page.waitForEvent('popup', { timeout: 7000 }).catch(() => null);
      await trigger.click();
      popup = await popupPromise;
      if (!popup) {
        await page.bringToFront();
        return { blogId, bloggerName: nameToUse, status: 'manual_required', message: '네이버 이웃추가 팝업을 열지 못했습니다.' };
      }

      await popup.waitForLoadState('domcontentloaded', { timeout: 7000 }).catch(() => {});
      const dialogMessages = [];
      popup.on('dialog', async (dialog) => {
        dialogMessages.push(dialog.message());
        await dialog.dismiss().catch(() => {});
      });
      const mutualChoice = popup.locator('#each_buddy_add');
      const changeChoice = popup.locator('#buddy_change');
      await Promise.race([
        mutualChoice.waitFor({ state: 'visible', timeout: 4000 }),
        changeChoice.waitFor({ state: 'visible', timeout: 4000 })
      ]).catch(() => {});

      if (await mutualChoice.isVisible().catch(() => false)) {
        if (await mutualChoice.isDisabled().catch(() => true)) {
          return { blogId, bloggerName: nameToUse, status: 'mutual_unavailable', message: '이 블로그는 서로이웃 신청을 받지 않습니다.' };
        }
        await popup.locator('label[for="each_buddy_add"]').click();
      } else if (await changeChoice.isVisible().catch(() => false)) {
        await popup.locator('label[for="buddy_change"]').click();
      } else {
        const known = classifyNeighborResult(await popup.locator('body').innerText().catch(() => ''));
        if (known.status !== 'unknown') return { blogId, bloggerName: nameToUse, ...known };
        await popup.bringToFront();
        return { blogId, bloggerName: nameToUse, status: 'manual_required', message: '서로이웃 선택 화면을 확인하지 못했습니다.' };
      }

      await popup.locator('a._buddyAddNext').click();
      await popup.waitForTimeout(400).catch(() => {});
      if (popup.isClosed()) {
        const closedResult = classifyNeighborResult(dialogMessages.join(' '));
        return {
          blogId,
          bloggerName: nameToUse,
          ...(closedResult.status === 'unknown'
            ? { status: 'manual_required', message: dialogMessages.at(-1) || '서로이웃 다음 단계에서 네이버 응답을 확인하지 못했습니다.' }
            : closedResult)
        };
      }
      const messageInput = popup.locator('#message');
      await messageInput.waitFor({ state: 'visible', timeout: 7000 });
      await messageInput.fill(finalMessage);
      const submitMutual = popup.locator('a._addBothBuddy');
      await submitMutual.waitFor({ state: 'visible', timeout: 7000 });
      await submitMutual.click().catch((error) => {
        if (!popup.isClosed()) throw error;
      });
      await popup.waitForTimeout(900).catch(() => {});
      const result = popup.isClosed()
        ? (() => {
            const closedResult = classifyNeighborResult(dialogMessages.join(' '));
            return closedResult.status === 'unknown'
              ? { status: 'requested', message: '서로이웃 신청이 완료되었습니다.' }
              : closedResult;
          })()
        : classifyNeighborResult(`${dialogMessages.join(' ')} ${await popup.locator('body').innerText().catch(() => '')}`);
      if (result.status === 'unknown') {
        if (!popup.isClosed()) await popup.close().catch(() => {});
        popup = null;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        const verifyFrame = page.frames().find((frame) => /\/(prologue\/PrologueList|PostView|PostList)\.naver/i.test(frame.url()));
        const verifyTrigger = verifyFrame?.locator('a._addBuddyPop');
        if (verifyTrigger && await verifyTrigger.count() === 1) {
          const verifyPopupPromise = page.waitForEvent('popup', { timeout: 7000 }).catch(() => null);
          await verifyTrigger.click();
          popup = await verifyPopupPromise;
          if (popup) {
            await popup.waitForLoadState('domcontentloaded', { timeout: 7000 }).catch(() => {});
            await popup.waitForTimeout(500);
            const verified = classifyNeighborResult(await popup.locator('body').innerText().catch(() => ''));
            if (verified.status === 'requested' || verified.status === 'already_mutual') {
              return { blogId, bloggerName: nameToUse, status: 'requested', message: '서로이웃 신청 후 상태 재확인이 완료되었습니다.' };
            }

            const verifyDialogs = [];
            popup.on('dialog', async (dialog) => {
              verifyDialogs.push(dialog.message());
              await dialog.dismiss().catch(() => {});
            });
            const verifyMutualChoice = popup.locator('#each_buddy_add');
            const verifyChangeChoice = popup.locator('#buddy_change');
            if (await verifyMutualChoice.isVisible().catch(() => false)) {
              await popup.locator('label[for="each_buddy_add"]').click();
            } else if (await verifyChangeChoice.isVisible().catch(() => false)) {
              await popup.locator('label[for="buddy_change"]').click();
            }
            const verifyNext = popup.locator('a._buddyAddNext');
            if (await verifyNext.isVisible().catch(() => false)) {
              await verifyNext.click();
              await popup.waitForTimeout(500).catch(() => {});
              const nextState = classifyNeighborResult(verifyDialogs.join(' '));
              if (nextState.status === 'requested' || nextState.status === 'already_mutual') {
                return { blogId, bloggerName: nameToUse, status: 'requested', message: '서로이웃 신청 상태를 재확인했습니다.' };
              }
            }
          }
        }
        return { blogId, bloggerName: nameToUse, status: 'manual_required', message: '최종 서로이웃 신청 상태를 확인하지 못했습니다.' };
      }
      return { blogId, bloggerName: nameToUse, ...result };
    } finally {
      if (popup && !popup.isClosed()) await popup.close().catch(() => {});
      if (!page.isClosed()) await page.close().catch(() => {});
    }
  }

  /**
   * Inspect a blog post to extract content snippet, images, and engagement status.
   */
  async inspectPostForEngagement(postUrl) {
    if (!this.connected) throw new Error('먼저 네이버 계정을 연결해주세요.');
    const page = await this.context.newPage();
    try {
      const cleanUrl = String(postUrl || '').trim();
      const blogId = extractBlogId(cleanUrl);
      if (!cleanUrl && !blogId) throw new Error('유효한 블로그 포스팅 주소가 없습니다.');

      let targetUrl = cleanUrl;
      const logNoMatch = cleanUrl.match(/(?:logNo=|\/)(\d{8,15})/);
      if (blogId && logNoMatch) {
        targetUrl = `https://m.blog.naver.com/${blogId}/${logNoMatch[1]}`;
      } else if (blogId) {
        targetUrl = `https://m.blog.naver.com/${blogId}`;
      }

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1000);

      // If on blog home, click or navigate to the latest post
      const isBlogHome = !page.url().match(/\/\d{8,15}/) && !targetUrl.match(/\/\d{8,15}/);
      if (isBlogHome) {
        const firstPostHref = await page.evaluate((bId) => {
          const links = Array.from(document.querySelectorAll('a[href*="' + bId + '/"]'));
          const postLink = links.find((a) => a.href && a.href.match(/\/\d{8,15}/));
          return postLink ? postLink.href : null;
        }, blogId);

        if (firstPostHref) {
          await page.goto(firstPostHref, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(1000);
        }
      }

      // Scroll down to load reaction modules
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.85));
      await page.waitForTimeout(1000);

      const inspection = await page.evaluate(() => {
        // Title
        const titleEl = document.querySelector('.se-title-text, .se-documentTitle, .tit_h3, h3.se_textarea, .post_title, .title_area, .se_title');
        const title = (titleEl?.innerText || titleEl?.textContent || '').trim();

        // Content Snippet
        const paragraphs = Array.from(document.querySelectorAll('.se-text-paragraph, .se-component-content, #postViewArea, .post_ct, .se_textarea'));
        const fullText = paragraphs.map((p) => (p.innerText || p.textContent || '').trim()).filter(Boolean).join('\n');
        const snippet = fullText.slice(0, 500);

        // Images
        const imgEls = Array.from(document.querySelectorAll('.se-image-resource, .se-component.se-image img, .se-module-image img, #postViewArea img, .se_mediaImage'));
        const images = imgEls.map((img) => ({
          src: img.src || img.getAttribute('data-src') || '',
          alt: img.alt || ''
        })).filter((img) => img.src && !img.src.includes('static.naver') && !img.src.includes('dthumb-phinf'));

        // Like Status
        const likeBtn = document.querySelector('.u_likeit_list_btn, button.u_likeit_button, .likeit_button, [data-type="like"]');
        const alreadyLiked = likeBtn ? (likeBtn.classList.contains('on') || likeBtn.getAttribute('aria-pressed') === 'true') : false;
        const canLike = !!likeBtn;

        // Comment Status
        const commentBtn = document.querySelector('button[class*="Interact__comment_btn"], button[data-click-area="pst.re"], .u_cbox_btn_comment, button[data-action="comment"], a.btn_comment, .btn_reply, .u_cbox_write_box, [contenteditable="true"]');
        const canComment = !!commentBtn || !!document.querySelector('.u_cbox, textarea[placeholder*="댓글"], div.u_cbox_text_mention');

        return {
          title,
          snippet,
          images: images.slice(0, 3),
          firstImage: images[0] || null,
          alreadyLiked,
          canLike,
          canComment
        };
      });

      return {
        url: page.url(),
        blogId: blogId || '',
        ...inspection
      };
    } finally {
      if (!page.isClosed()) await page.close().catch(() => {});
    }
  }

  /**
   * Perform Like (Heart) and AI Comment on a Naver Blog post.
   */
  async likeAndCommentPost({ postUrl, commentText = '', doLike = true, doComment = true }) {
    if (!this.connected) throw new Error('먼저 네이버 계정을 연결해주세요.');
    const page = await this.context.newPage();
    const cleanUrl = String(postUrl || '').trim();
    const blogId = extractBlogId(cleanUrl);

    const result = {
      postUrl: cleanUrl,
      liked: false,
      likeReason: '',
      commented: false,
      commentReason: '',
      commentText: '',
      status: 'success',
      message: ''
    };

    try {
      let targetUrl = cleanUrl;
      const logNoMatch = cleanUrl.match(/(?:logNo=|\/)(\d{8,15})/);
      if (blogId && logNoMatch) {
        targetUrl = `https://m.blog.naver.com/${blogId}/${logNoMatch[1]}`;
      } else if (blogId) {
        targetUrl = `https://m.blog.naver.com/${blogId}`;
      }

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1000);

      // If on blog home, enter latest post
      const isBlogHome = !page.url().match(/\/\d{8,15}/) && !targetUrl.match(/\/\d{8,15}/);
      if (isBlogHome && blogId) {
        const firstPostHref = await page.evaluate((bId) => {
          const links = Array.from(document.querySelectorAll('a[href*="' + bId + '/"]'));
          const postLink = links.find((a) => a.href && a.href.match(/\/\d{8,15}/));
          return postLink ? postLink.href : null;
        }, blogId);

        if (firstPostHref) {
          await page.goto(firstPostHref, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(1000);
        }
      }

      // Find active frame (support PC iframe#mainFrame or mobile page)
      const frame = page.frames().find((f) => f.name() === 'mainFrame') || page.mainFrame();

      // Scroll down on both page and frame to trigger lazy loading of Like and Comment components
      await frame.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.85)).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.85)).catch(() => {});
      await page.waitForTimeout(1500);

      // 1. Perform Like (Heart)
      if (doLike) {
        try {
          const likeSelectors = [
            '.u_likeit_list_btn',
            'button.u_likeit_button',
            'a.u_likeit_button',
            '.u_likeit_module a',
            '.u_likeit_module button',
            '[data-type="like"]',
            'button.btn_like',
            'a.btn_like',
            'a[class*="u_likeit"]',
            'button[class*="u_likeit"]',
            '._likeit_btn'
          ];

          let foundLikeBtn = false;
          for (const selector of likeSelectors) {
            const btn = frame.locator(selector).first();
            if (await btn.isVisible().catch(() => false)) {
              foundLikeBtn = true;
              const isAlreadyLiked = await btn.evaluate((el) => {
                return el.classList.contains('on') || 
                       el.getAttribute('aria-pressed') === 'true' || 
                       el.classList.contains('_like_on');
              }).catch(() => false);

              if (!isAlreadyLiked) {
                await btn.click({ force: true }).catch(() => btn.dispatchEvent('click'));
                await page.waitForTimeout(1000);
                result.liked = true;
                result.likeReason = '공감 누름 완료';
              } else {
                result.liked = true;
                result.likeReason = '이미 공감된 포스팅';
              }
              break;
            }
          }
          if (!foundLikeBtn) {
            result.likeReason = '작성자가 공감(하트)을 비허용으로 설정함';
          }
        } catch (err) {
          result.likeReason = `공감 오류: ${err.message}`;
        }
      }

      // 2. Perform Comment
      if (doComment && commentText) {
        try {
          // Check for explicit permission notice on the page
          const disabledNotice = await frame.evaluate(() => {
            const bodyText = document.body.innerText || '';
            if (bodyText.includes('댓글 작성이 제한된') || bodyText.includes('댓글을 쓸 수 없습니다')) {
              return '이웃/서로이웃에게만 댓글 허용된 포스팅';
            }
            if (bodyText.includes('댓글이 허용되지 않은') || bodyText.includes('댓글을 등록할 수 없습니다')) {
              return '작성자가 댓글 작성을 비허용(닫음)으로 설정함';
            }
            return null;
          }).catch(() => null);

          if (disabledNotice) {
            result.commentReason = disabledNotice;
          } else {
            // Step A: Open comment box if needed (Support modern 2026 Naver UI + Classic UI)
            const commentOpenSelectors = [
              'button[class*="Interact__comment_btn"]',
              'button[data-click-area="pst.re"]',
              'button:has(span.blind:has-text("댓글"))',
              '[class*="comment_btn"]',
              '.u_cbox_btn_comment',
              '.u_cbox_btn_total',
              'button[data-action="comment"]',
              'a[data-action="comment"]',
              'a.btn_comment',
              'button.btn_comment',
              'a[href*="comment"]',
              '._commentCount',
              'a.u_cbox_link',
              '.btn_reply',
              'a#comment_top_anchor'
            ];

            for (const selector of commentOpenSelectors) {
              const openBtn = frame.locator(selector).first();
              if (await openBtn.isVisible().catch(() => false)) {
                await openBtn.click({ force: true }).catch(() => openBtn.dispatchEvent('click'));
                await page.waitForTimeout(1500);
                break;
              }
            }

            // Step B: Click placeholder box to activate input mode if needed
            const placeholderSelectors = [
              '.u_cbox_write_box',
              '.u_cbox_write_area',
              '.u_cbox_inbox',
              '.u_cbox_write_wrap',
              '.u_cbox_guide',
              '.u_cbox_write_inner'
            ];
            for (const sel of placeholderSelectors) {
              const box = frame.locator(sel).first();
              if (await box.isVisible().catch(() => false)) {
                await box.click({ force: true }).catch(() => {});
                await page.waitForTimeout(600);
                break;
              }
            }

            // Step C: Find comment input (Support contenteditable div and textarea)
            const textareaSelectors = [
              'div.u_cbox_text_mention',
              'div.u_cbox_text',
              'div[contenteditable="true"]',
              '[contenteditable="true"]',
              'textarea.u_cbox_text_mention',
              'textarea.u_cbox_text',
              '.u_cbox_write_area textarea',
              '.u_cbox_inbox textarea',
              '#comment_write_textarea',
              'textarea[placeholder*="댓글"]',
              'textarea[title*="댓글"]'
            ];

            let textarea = null;
            for (const selector of textareaSelectors) {
              const el = frame.locator(selector).first();
              if (await el.isVisible().catch(() => false)) {
                textarea = el;
                break;
              }
            }

            if (!textarea) {
              result.commentReason = '작성자가 댓글 비허용 또는 댓글창 닫힘';
            } else {
              await textarea.focus().catch(() => {});
              await textarea.click({ force: true }).catch(() => {});
              await page.waitForTimeout(300);

              // Fill via evaluate and dispatch events to trigger submit button activation
              await frame.evaluate(({ text }) => {
                const el = document.querySelector('div.u_cbox_text_mention, div.u_cbox_text, [contenteditable="true"], textarea.u_cbox_text_mention, textarea.u_cbox_text, #comment_write_textarea');
                if (el) {
                  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    el.value = text;
                  } else {
                    el.innerText = text;
                  }
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                }
              }, { text: commentText }).catch(() => {});

              // Key typing to trigger UI state
              await page.keyboard.type(' ').catch(() => {});
              await page.keyboard.press('Backspace').catch(() => {});
              await page.waitForTimeout(600);

              // Step D: Submit comment
              const submitSelectors = [
                'button.u_cbox_btn_upload',
                'button.__uis_naverComment_writeButton',
                'button[type="submit"].u_cbox_btn',
                '.u_cbox_upload button',
                'button._btn_upload',
                'button[class*="btn_upload"]',
                'a.btn_register',
                'button:has-text("등록")',
                'a:has-text("등록")'
              ];

              let submitted = false;
              for (const selector of submitSelectors) {
                const submitBtn = frame.locator(selector).first();
                if (await submitBtn.isVisible().catch(() => false)) {
                  await submitBtn.evaluate((btn) => btn.removeAttribute('disabled')).catch(() => {});
                  await submitBtn.click({ force: true }).catch(() => submitBtn.dispatchEvent('click'));
                  await page.waitForTimeout(2000);
                  result.commented = true;
                  result.commentText = commentText;
                  result.commentReason = '댓글 등록 성공';
                  submitted = true;
                  break;
                }
              }

              if (!submitted) {
                result.commentReason = '댓글 등록 버튼 클릭 실패 (작성 제한/권한 없음)';
              }
            }
          }
        } catch (err) {
          result.commentReason = `댓글 오류: ${err.message}`;
        }
      }

      const actions = [];
      if (result.liked) actions.push('공감(❤️)');
      if (result.commented) actions.push('댓글 작성');
      
      let failDetail = '';
      if (doComment && !result.commented) failDetail = ` (댓글 미작성: ${result.commentReason || '비허용'})`;
      if (doLike && !result.liked) failDetail += ` (공감 미적용: ${result.likeReason || '비허용'})`;

      result.message = actions.length > 0 
        ? `${actions.join(' 및 ')} 완료${failDetail}` 
        : `반응 불가 (사유: ${result.commentReason || result.likeReason || '제한된 글'})`;

      return result;
    } finally {
      if (!page.isClosed()) await page.close().catch(() => {});
    }
  }

  async searchBlogs({ query, display = 30, activeWithinDays = 0, excludeBlogIds = [] }) {
    if (!this.connected) throw new Error('먼저 네이버 계정을 연결해주세요.');
    const page = await this.context.newPage();
    const excludeSet = new Set((excludeBlogIds || []).map((id) => String(id).toLowerCase().trim()));
    try {
      const limit = Math.min(Math.max(Number(display) || 30, 1), 100);
      const url = `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${encodeURIComponent(query)}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      const blogsMap = new Map();
      const maxScrolls = Math.max(Math.ceil(limit / 5), 15);

      for (let scroll = 0; scroll < maxScrolls; scroll += 1) {
        const rawCards = await page.evaluate(() => {
          const cards = document.querySelectorAll('.view_wrap, .bx, li.bx, .detail_box, .total_wrap');
          const list = [];
          for (const card of cards) {
            const linkEl = card.querySelector('a.title_link, a.api_txt_lines, a[href*="blog.naver.com"]');
            if (!linkEl) continue;
            const href = linkEl.href || '';
            const title = (linkEl.innerText || linkEl.textContent || '').trim();
            const nameEl = card.querySelector('.name, .user_info .name, .source, a.name, .user_box .name');
            const bloggerName = nameEl ? (nameEl.innerText || nameEl.textContent || '').replace(/새 창 열림/g, '').trim() : '';
            const dscEl = card.querySelector('.dsc_link, .detail_dsc, .dsc_area, .dsc, .total_dsc');
            const description = dscEl ? (dscEl.innerText || dscEl.textContent || '').trim() : '';
            const timeEl = card.querySelector('.sub_time, .date, span.txt_time, .sub_txt, .time');
            const postDate = timeEl ? (timeEl.innerText || timeEl.textContent || '').trim() : '';
            list.push({ href, title, bloggerName, description, postDate });
          }
          return list;
        });

        for (const card of rawCards) {
          const blogId = extractBlogId(card.href);
          if (!blogId || excludeSet.has(blogId.toLowerCase())) continue;
          if (activeWithinDays > 0 && card.postDate && !isPostActiveWithinDays(card.postDate, activeWithinDays)) {
            continue;
          }
          if (!blogsMap.has(blogId)) {
            blogsMap.set(blogId, {
              blogId,
              title: card.title || '',
              description: card.description || '',
              bloggerName: card.bloggerName || blogId,
              link: `https://blog.naver.com/${blogId}`,
              url: card.href || `https://blog.naver.com/${blogId}`,
              postDate: card.postDate || ''
            });
          }
        }

        if (blogsMap.size >= limit) break;

        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(650);
      }

      // Fallback if cards were not parsed by specific selectors
      if (blogsMap.size === 0) {
        const links = page.locator('a[href*="blog.naver.com"]');
        const count = await links.count();
        if (count > 0) {
          const records = await links.evaluateAll((anchors) => anchors.map((anchor) => ({
            href: anchor.href,
            text: (anchor.innerText || anchor.textContent || '').trim()
          })));
          const parsed = normalizeWebSearchLinks(records);
          for (const item of parsed) {
            if (!excludeSet.has(item.blogId.toLowerCase())) {
              blogsMap.set(item.blogId, item);
            }
          }
        }
      }

      return [...blogsMap.values()].slice(0, limit);
    } finally {
      await page.close().catch(() => {});
    }
  }

  async publishBlogPost({ title, content, tags = [], images = [], imagePaths = [], isDeals = false }) {
    if (!this.connected) {
      await this.restoreSession().catch(() => {});
    }
    if (!this.connected || !await this.hasAuthenticatedSession()) {
      const error = new Error('네이버 로그인 세션이 만료되었습니다. 계정을 다시 연결해주세요.');
      error.code = 'NAVER_SESSION_EXPIRED';
      throw error;
    }
    const cleanTitle = String(title || '').trim();
    const cleanContent = String(content || '').trim();
    if (cleanTitle.length < 2 || cleanTitle.length > 200) throw new Error('제목을 2~200자로 입력해주세요.');
    if (cleanContent.length < 20 || cleanContent.length > 50000) throw new Error('본문을 20~50,000자로 입력해주세요.');

    const normalizedTags = [...new Set((Array.isArray(tags) ? tags : [])
      .map((tag) => String(tag).replace(/^#+/, '').trim())
      .filter(Boolean))].slice(0, 10);
    const finalContent = normalizedTags.length
      ? `${cleanContent}\n\n${normalizedTags.map((tag) => `#${tag.replace(/\s+/g, '')}`).join(' ')}`
      : cleanContent;
    const page = await this.context.newPage();
    let keepOpen = false;

    try {
      await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      if (/nidlogin\.login/i.test(page.url())) {
        keepOpen = true;
        await page.bringToFront();
        return { ...classifyPublishResult({ url: page.url() }), url: page.url() };
      }

      await page.keyboard.press('Escape').catch(() => {});
      const editorFrame = page.frames().find((frame) => /\/PostWriteForm\.naver/i.test(frame.url()));
      if (!editorFrame) {
        keepOpen = true;
        await page.bringToFront();
        return { status: 'manual_required', message: '네이버 글쓰기 프레임을 찾지 못했습니다. 열린 에디터에서 직접 확인해주세요.', url: page.url() };
      }

      // Dismiss any popups inside editorFrame (draft restore dialog, help popups, etc.)
      for (let attempt = 0; attempt < 3; attempt++) {
        const popups = editorFrame.locator('.se-popup-button-cancel, .se-popup-alert button:has-text("취소"), .se-help-panel-close-button, .se-popup-button-confirm');
        const pCount = await popups.count().catch(() => 0);
        let clicked = false;
        for (let i = 0; i < pCount; i++) {
          const btn = popups.nth(i);
          if (await btn.isVisible().catch(() => false)) {
            await btn.click({ force: true }).catch(() => {});
            clicked = true;
          }
        }
        if (clicked) await page.waitForTimeout(500);
        else break;
      }
      const titleEditor = editorFrame.locator('.se-documentTitle .se-text-paragraph, .se-documentTitle [contenteditable="true"], [data-placeholder*="제목"]').first();
      if (await titleEditor.count().catch(() => 0) === 0) {
        keepOpen = true;
        await page.bringToFront().catch(() => {});
        return { status: 'manual_required', message: '네이버 글쓰기 입력란을 찾지 못했습니다. 열린 에디터에서 직접 확인해주세요.', url: page.url() };
      }

      await replaceEditorText(page, editorFrame, titleEditor, cleanTitle, true);
      const selectedImages = (Array.isArray(images) && images.length
        ? images
        : (Array.isArray(imagePaths) ? imagePaths : []).map((filePath) => ({ filePath })))
        .slice(0, 5);
      await insertEditorContentWithImages(page, editorFrame, finalContent, selectedImages, isDeals);
      await applyInlineLinks(page, editorFrame, finalContent);
      if (isDeals) {
        await verifyEditorProductLayout(page, editorFrame, finalContent, selectedImages);
      }

      // Remove any lingering dim / tooltip / help overlays
      await editorFrame.evaluate(() => {
        document.querySelectorAll('.se-popup-dim, .se-help-panel, [class*="dim__"]').forEach((el) => el.remove());
      }).catch(() => {});

      const openPublish = editorFrame.locator('[data-click-area="tpb.publish"], button[class*="publish_btn__"], button[class*="publish_btn"]').first();
      if (await openPublish.count().catch(() => 0) === 0) {
        keepOpen = true;
        await page.bringToFront().catch(() => {});
        return { status: 'manual_required', message: '초안은 입력했지만 네이버 발행 버튼을 찾지 못했습니다.', url: page.url() };
      }

      await openPublish.click({ force: true }).catch(() => openPublish.dispatchEvent('click'));
      await page.waitForTimeout(2000);

      const confirmPublish = await findFinalPublishButton(page, editorFrame);
      if (!confirmPublish) {
        keepOpen = true;
        await page.bringToFront().catch(() => {});
        return { status: 'manual_required', message: '초안과 발행 설정을 열었습니다. 마지막 발행 버튼을 확인해주세요.', url: page.url() };
      }

      await confirmPublish.scrollIntoViewIfNeeded().catch(() => {});
      await confirmPublish.click({ force: true }).catch(() => confirmPublish.dispatchEvent('click'));
      await page.waitForTimeout(1000);
      
      let publishedPostUrl = '';
      for (let s = 0; s < 30; s++) {
        await page.waitForTimeout(1000);
        const frames = page.frames().map((f) => f.url());
        const cur = page.url();
        const found = frames.find((u) => /PostView\.naver|\/\d{10,}/.test(u)) || (cur.match(/\/\d{10,}/) ? cur : null);
        if (found) {
          publishedPostUrl = found;
          break;
        }

        // If after 3s the publish layer is still open, retry clicking confirm
        if (s === 3 || s === 6) {
          const retryConfirm = await findFinalPublishButton(page, editorFrame);
          if (retryConfirm && await retryConfirm.isVisible().catch(() => false)) {
            await retryConfirm.click({ force: true }).catch(() => {});
            await retryConfirm.dispatchEvent('click').catch(() => {});
          }
        }
      }

      if (publishedPostUrl) {
        return {
          status: 'published',
          message: '블로그 글이 성공적으로 발행되었습니다!',
          url: publishedPostUrl
        };
      }
      keepOpen = true;
      await page.bringToFront().catch(() => {});
      return {
        status: 'manual_required',
        message: '네이버가 새 글 주소를 확인해주지 않았습니다. 열린 발행 화면의 안내를 확인한 뒤 다시 발행해주세요.',
        url: page.url()
      };
    } catch (error) {
      keepOpen = true;
      await page.bringToFront().catch(() => {});
      throw error;
    } finally {
      if (!keepOpen && !page.isClosed()) await page.close().catch(() => {});
    }
  }

  async prepareBlogPostUpdate({ blogId, logNo, title, content, tags = [], images = [], links = [] }) {
    if (!this.connected) {
      await this.restoreSession().catch(() => {});
    }
    if (!this.connected || !await this.hasAuthenticatedSession()) {
      const error = new Error('네이버 로그인 세션이 만료되었습니다. 계정을 다시 연결해주세요.');
      error.code = 'NAVER_SESSION_EXPIRED';
      throw error;
    }
    const cleanBlogId = String(blogId || '').trim();
    const cleanLogNo = String(logNo || '').replace(/\D/g, '');
    const cleanTitle = String(title || '').trim();
    const cleanContent = String(content || '').trim();
    if (!/^[a-zA-Z0-9._-]{2,80}$/.test(cleanBlogId) || !/^\d{8,20}$/.test(cleanLogNo)) {
      throw new Error('수정할 네이버 블로그 글 주소가 올바르지 않습니다.');
    }
    if (cleanTitle.length < 2 || cleanTitle.length > 200) throw new Error('제목을 2~200자로 입력해주세요.');
    if (cleanContent.length < 20 || cleanContent.length > 50000) throw new Error('본문을 20~50,000자로 입력해주세요.');

    const normalizedTags = [...new Set((Array.isArray(tags) ? tags : [])
      .map((tag) => String(tag).replace(/^#+/, '').trim())
      .filter(Boolean))].slice(0, 10);
    const finalContent = normalizedTags.length
      ? `${cleanContent}\n\n${normalizedTags.map((tag) => `#${tag.replace(/\s+/g, '')}`).join(' ')}`
      : cleanContent;
    const selectedImages = (Array.isArray(images) ? images : []).slice(0, 5);

    if (this.pendingPostUpdate?.page && !this.pendingPostUpdate.page.isClosed()) {
      await this.pendingPostUpdate.page.close().catch(() => {});
    }
    this.pendingPostUpdate = null;
    const page = await this.context.newPage();
    try {
      const updateUrl = `https://blog.naver.com/PostUpdateForm.naver?blogId=${encodeURIComponent(cleanBlogId)}&logNo=${cleanLogNo}`;
      await page.goto(updateUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      if (/nidlogin\.login/i.test(page.url())) throw new Error('네이버 로그인 세션이 만료되었습니다.');
      const editorFrame = page.frames().find((frame) => /\/PostUpdateForm\.naver/i.test(frame.url())) || page.mainFrame();
      await dismissEditorPopups(page, editorFrame);

      const titleEditor = editorFrame.locator('.se-documentTitle .se-text-paragraph, .se-documentTitle [contenteditable="true"], [data-placeholder*="제목"]').first();
      if (await titleEditor.count().catch(() => 0) === 0) throw new Error('네이버 수정 화면의 제목 입력란을 찾지 못했습니다.');
      await replaceEditorText(page, editorFrame, titleEditor, cleanTitle, true);
      await clearEditorBody(page, editorFrame);
      await insertEditorContentWithImages(page, editorFrame, finalContent, selectedImages);
      await applyInlineLinks(page, editorFrame, finalContent, links);
      await verifyEditorProductLayout(page, editorFrame, finalContent, selectedImages);

      this.pendingPostUpdate = { page, editorFrame, blogId: cleanBlogId, logNo: cleanLogNo };
      await page.bringToFront().catch(() => {});
      return {
        status: 'ready',
        message: '수정 내용을 편집기에 배치했습니다. 최종 저장 전입니다.',
        url: page.url(),
        imageCount: await countEditorImages(editorFrame)
      };
    } catch (error) {
      await page.bringToFront().catch(() => {});
      throw error;
    }
  }

  async confirmPreparedBlogPostUpdate() {
    const pending = this.pendingPostUpdate;
    if (!pending?.page || pending.page.isClosed()) throw new Error('저장 대기 중인 블로그 수정 내용이 없습니다.');
    const { page, editorFrame, blogId, logNo } = pending;
    const openPublish = editorFrame.locator('[data-click-area="tpb.publish"], button[class*="publish_btn__"], button[class*="publish_btn"]').first();
    if (await openPublish.count().catch(() => 0) === 0) throw new Error('네이버 수정 버튼을 찾지 못했습니다.');
    await openPublish.click({ force: true }).catch(() => openPublish.dispatchEvent('click'));
    await page.waitForTimeout(1200);
    const confirmPublish = editorFrame.locator('[data-click-area="ptp.publish"], button.btn_publish, button[class*="confirm_btn"], [class*="publish_layer"] button:has-text("발행"), button:has-text("수정"), button:has-text("발행하기")').first();
    if (await confirmPublish.count().catch(() => 0) === 0) throw new Error('네이버 최종 수정 저장 버튼을 찾지 못했습니다.');
    await confirmPublish.click({ force: true }).catch(() => confirmPublish.dispatchEvent('click'));
    await page.waitForTimeout(2500);
    this.pendingPostUpdate = null;
    if (!page.isClosed()) await page.close().catch(() => {});
    return {
      status: 'updated',
      message: '기존 블로그 글을 수정했습니다.',
      url: `https://blog.naver.com/${blogId}/${logNo}`
    };
  }

  async close() {
    if (this.pendingPostUpdate?.page && !this.pendingPostUpdate.page.isClosed()) {
      await this.pendingPostUpdate.page.close().catch(() => {});
    }
    this.pendingPostUpdate = null;
    if (this.context && this.connectedId) await this.saveSessionState().catch(() => {});
    this.connectedId = '';
    this.page = null;
    const context = this.context;
    const browser = this.browser;
    this.context = null;
    this.browser = null;
    if (context) await context.close().catch(() => {});
    if (browser?.isConnected()) await browser.close().catch(() => {});
  }
}

async function findVisibleLocator(page, selectors, exactText = '') {
  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = matches.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      if (exactText) {
        const text = (await candidate.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        if (!text.includes(exactText)) continue;
      }
      return candidate;
    }
  }
  return null;
}

async function findFinalPublishButton(page, editorFrame) {
  const targets = [editorFrame, page];

  // 1. Explicit Naver SmartEditor ONE confirm data attribute or class
  for (const target of targets) {
    const ptp = target.locator('[data-click-area="ptp.publish"]').first();
    if (await ptp.isVisible().catch(() => false)) return ptp;

    const confirmBtn = target.locator('button[class*="confirm_btn"], button[class*="btn_confirm"], button[class*="publish_confirm"]').first();
    if (await confirmBtn.isVisible().catch(() => false)) return confirmBtn;
  }

  // 2. Look inside the publish settings layer first
  for (const target of targets) {
    const layer = target.locator('.publish_layer, [class*="publish_layer"], [class*="layer_publish"], .se-publish-layer, [data-layer="publish"], [class*="setting_layer"], [class*="popup_publish"]');
    if (await layer.count().catch(() => 0) > 0) {
      const confirmInLayer = layer.locator('button').filter({ hasText: /발행/ }).last();
      if (await confirmInLayer.isVisible().catch(() => false)) return confirmInLayer;
    }
  }

  // 3. Search buttons in reverse order, strictly ignoring the top toolbar button (tpb.publish)
  for (const target of targets) {
    const buttons = target.locator('button');
    const count = await buttons.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const button = buttons.nth(index);
      if (!await button.isVisible().catch(() => false)) continue;
      const clickArea = await button.getAttribute('data-click-area').catch(() => '');
      if (clickArea === 'tpb.publish') continue; // NEVER click top toolbar button!

      const label = (await button.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (/(?:발행|발행하기|게시하기)/.test(label)) return button;
    }
  }
  return null;
}

async function replaceEditorText(page, editorFrame, locator, value, isTitle = false) {
  if (isTitle) {
    if (locator) {
      await locator.click({ force: true }).catch(() => locator.dispatchEvent('click'));
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);
    }
    await page.keyboard.insertText(String(value || '').trim());
    return;
  }

  // A fixed canvas coordinate can land inside the title area on tall/zoomed
  // editors. Focus an actual body paragraph so title and body never merge.
  const bodyParagraph = editorFrame.locator('.se-components-wrap .se-component.se-text .se-text-paragraph, .se-main-container .se-component.se-text .se-text-paragraph, .se-content .se-component.se-text .se-text-paragraph').first();
  if (await bodyParagraph.count().catch(() => 0) === 0) throw new Error('네이버 편집기의 본문 입력란을 찾지 못했습니다.');
  await bodyParagraph.click({ force: true }).catch(() => bodyParagraph.dispatchEvent('click'));
  await page.waitForTimeout(300);
  await typeEditorLines(page, value);
}

async function insertEditorContentWithImages(page, editorFrame, content, images = [], isDeals = false) {
  const pending = images
    .filter((image) => image?.filePath && existsSync(image.filePath))
    .map((image) => ({ ...image }));
  if (pending.length !== images.length) throw new Error('게시할 상품 이미지 파일을 준비하지 못했습니다.');

  const imagesByLine = mapImagesToContentLines(content, pending);
  const bodyParagraph = editorFrame.locator('.se-components-wrap .se-component.se-text .se-text-paragraph, .se-main-container .se-component.se-text .se-text-paragraph, .se-content .se-component.se-text .se-text-paragraph').first();
  if (await bodyParagraph.count().catch(() => 0) === 0) throw new Error('네이버 편집기의 본문 입력란을 찾지 못했습니다.');
  await bodyParagraph.click({ force: true }).catch(() => bodyParagraph.dispatchEvent('click'));
  await page.waitForTimeout(250);

  const lines = String(content || '').split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const emphasize = /^(오늘의 핫딜 한눈에 보기|상품 \d+ \||마무리$)/.test(line.trim());
    if (emphasize) await page.keyboard.press('Control+B');
    const lineResult = line ? await typeEditorLine(page, line, isDeals) : {};
    if (emphasize) await page.keyboard.press('Control+B');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(10);
    if (lineResult?.pastedUrl) {
      await page.waitForTimeout(350);
      let linkPlacement = await focusEditorEnd(editorFrame);
      if (!linkPlacement.found) linkPlacement = await focusEditorEndWithKeyboard(page, editorFrame);
      if (!linkPlacement.found) throw new Error(`링크 다음 본문 위치를 준비하지 못했습니다: ${line}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(80);
    }
    const lineImages = imagesByLine.get(lineIndex) || [];
    for (const image of lineImages) {
      await uploadEditorImages(page, editorFrame, [image.filePath]);
      let placement = await focusEditorEnd(editorFrame);
      if (!placement.found) placement = await focusEditorEndWithKeyboard(page, editorFrame);
      if (!placement.found) throw new Error(`이미지 다음 본문 위치를 준비하지 못했습니다: ${image.title || '이미지'}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
    }
  }
}

async function typeEditorLines(page, value, isDeals = false) {
  const lines = String(value || '').split('\n');
  for (const line of lines) {
    const result = line ? await typeEditorLine(page, line, isDeals) : {};
    await page.keyboard.press('Enter');
    if (result?.pastedUrl) await page.keyboard.press('Control+End');
    await page.waitForTimeout(10);
  }
}

async function typeEditorLine(page, line, isDeals = false) {
  const value = String(line || '');
  const urlMatch = value.match(/^(.*?)(https?:\/\/\S+)(\s+.*)?$/);
  if (!urlMatch) {
    await page.keyboard.insertText(value);
    return { pastedUrl: false };
  }
  await page.keyboard.insertText(urlMatch[1]);
  let linkedPaste = false;
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://blog.naver.com' });
    await page.evaluate(async (url) => {
      const escaped = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([`<a href="${escaped}">${escaped}</a>`], { type: 'text/html' }),
        'text/plain': new Blob([url], { type: 'text/plain' })
      })]);
    }, urlMatch[2]);
    await page.keyboard.press('Control+V');
    linkedPaste = true;
  } catch {}
  if (!linkedPaste) await page.keyboard.type(urlMatch[2], { delay: 1 });

  if (urlMatch[3]?.trim()) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(80);
    await page.keyboard.insertText(urlMatch[3].trim());
  } else if (isDeals) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(80);
    await page.keyboard.insertText('상품 페이지 열기');
  }
  return { pastedUrl: true };
}

async function applyInlineLinks(page, editorFrame, content, requestedLinks = []) {
  const inferredLinks = [...new Set(String(content || '').match(/https?:\/\/[^\s]+/g) || [])]
    .map((url) => ({ text: url, href: url }));
  if (!Array.isArray(requestedLinks) || !requestedLinks.length) {
    await page.waitForTimeout(300);
    const nativeLinks = await editorFrame.evaluate(() => Array.from(document.querySelectorAll('.se-components-wrap .se-text-paragraph .se-link, .se-components-wrap .se-text-paragraph a[href], .se-main-container .se-text-paragraph .se-link, .se-main-container .se-text-paragraph a[href]'))
      .map((element) => ({
        text: (element.textContent || '').trim(),
        href: element.getAttribute('data-href') || element.getAttribute('href') || ''
      }))).catch(() => []);
    const missing = inferredLinks.filter((link) => !nativeLinks.some((native) => native.text === link.text && (native.href === link.href || native.href.includes(link.href))));
    if (!missing.length) return;
    requestedLinks = missing;
  }
  const links = (Array.isArray(requestedLinks) && requestedLinks.length ? requestedLinks : inferredLinks)
    .map((link) => ({ text: String(link?.text || '').trim(), href: String(link?.href || '').trim() }))
    .filter((link) => link.text && /^https?:\/\//i.test(link.href))
    .slice(0, 20);
  for (const link of links) {
    // URL text is a native SmartEditor link target. Select that exact URL,
    // then use the editor's own link dialog so the link survives publishing.
    const selection = await editorFrame.evaluate(({ targetText, targetHref }) => {
      const root = document.querySelector('.se-components-wrap, .se-main-container, .se-content');
      if (!root) return { found: false };
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const index = String(node.nodeValue || '').indexOf(targetText);
        if (index < 0) continue;
        const existing = node.parentElement?.closest('.se-text-paragraph .se-link, .se-text-paragraph a[href]');
        if (existing) {
          const href = existing.getAttribute('data-href') || existing.getAttribute('href') || '';
          if (href === targetHref || href.includes(targetHref)) return { found: true, linked: true };
          continue;
        }
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + targetText.length);
        const editable = node.parentElement?.closest('[contenteditable="true"]');
        editable?.focus();
        const selected = window.getSelection();
        selected.removeAllRanges();
        selected.addRange(range);
        document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
        const applied = document.execCommand('createLink', false, targetHref);
        const linked = node.parentElement?.closest('a[href]')
          || editable?.querySelector(`a[href="${CSS.escape(targetHref)}"]`);
        if (applied && linked) {
          linked.classList.add('se-link');
          linked.setAttribute('data-href', targetHref);
          editable?.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'formatCreateLink',
            data: null
          }));
          return { found: true, linked: true, text: linked.textContent || '' };
        }
        return { found: true, linked: false, text: selected.toString() };
      }
      return { found: false };
    }, { targetText: link.text, targetHref: link.href }).catch(() => ({ found: false }));
    if (!selection.found) throw new Error(`본문에서 상품 URL을 찾지 못했습니다: ${link.href}`);
    if (selection.linked) continue;
    await page.waitForTimeout(150);

    const linkButton = editorFrame.locator('button.se-link-toolbar-button[data-name="text-link"], button.se-link-toolbar-button').first();
    if (!await linkButton.isVisible().catch(() => false)) throw new Error(`상품 링크 도구를 열지 못했습니다: ${link.text}`);
    await linkButton.click({ force: true });
    await page.waitForTimeout(150);
    const input = editorFrame.locator('input.se-custom-layer-link-input[placeholder*="URL"], input.se-custom-layer-link-input').first();
    const applyButton = editorFrame.locator('button.se-custom-layer-link-apply-button').first();
    if (!await input.isVisible().catch(() => false) || !await applyButton.isVisible().catch(() => false)) {
      throw new Error(`상품 링크 입력창을 찾지 못했습니다: ${link.text}`);
    }
    await input.fill(link.href);
    await applyButton.click({ force: true });
    await page.waitForTimeout(180);
  }

  const linkedUrls = await editorFrame.evaluate(() => Array.from(document.querySelectorAll('.se-text-paragraph .se-link, .se-text-paragraph a[href]'))
    .map((element) => element.getAttribute('data-href') || element.getAttribute('href') || '')
    .filter(Boolean)).catch(() => []);
  const missing = links.filter((link) => !linkedUrls.some((linked) => linked === link.href || linked.includes(link.href)));
  if (missing.length) throw new Error(`클릭 가능한 상품 링크를 만들지 못했습니다: ${missing.map((link) => link.text).join(', ')}`);
}

export function mapImagesToContentLines(content, images = []) {
  const lines = String(content || '').split('\n');
  const mapped = new Map();
  const totalImages = images.length;
  if (!totalImages || !lines.length) return mapped;

  // Identify all potential heading/section separator lines
  const candidateHeadingIndices = [];
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      if (/^(\d+\s*[\.위\)]|[#■◆●▶★\-]|\[\d+\]|STEP\s*\d+|첫[째번째]|둘[째번째]|셋[째번째]|넷[째번째]|다섯[째번째])/i.test(trimmed) || (trimmed.length < 50 && trimmed.endsWith(':'))) {
        candidateHeadingIndices.push(idx);
      }
    }
  });

  const usedLineIndices = new Set();

  images.forEach((image, imgIdx) => {
    const rawHeading = String(image?.afterHeading || '').trim();
    const cleanHeading = rawHeading.replace(/^[#\s0-9.\[\]■◆●▶★\-:위]+/g, '').replace(/\s+/g, '').toLowerCase();
    const cleanTitle = String(image?.title || '').replace(/^[#\s0-9.\[\]■◆●▶★\-:위]+/g, '').replace(/\s+/g, '').toLowerCase();

    let bestLineIndex = -1;

    // 1. Try to find line matching afterHeading
    if (cleanHeading.length >= 2) {
      bestLineIndex = lines.findIndex((line, lIdx) => {
        if (usedLineIndices.has(lIdx)) return false;
        const cl = line.replace(/^[#\s0-9.\[\]■◆●▶★\-:위]+/g, '').replace(/\s+/g, '').toLowerCase();
        return cl.length >= 2 && (cl.includes(cleanHeading) || cleanHeading.includes(cl));
      });
    }

    // 2. Try to find line matching image title
    if (bestLineIndex < 0 && cleanTitle.length >= 2) {
      bestLineIndex = lines.findIndex((line, lIdx) => {
        if (usedLineIndices.has(lIdx)) return false;
        const cl = line.replace(/^[#\s0-9.\[\]■◆●▶★\-:위]+/g, '').replace(/\s+/g, '').toLowerCase();
        return cl.length >= 2 && cl.includes(cleanTitle);
      });
    }

    // 3. Match candidate heading index based on image sequence
    if (bestLineIndex < 0 && candidateHeadingIndices.length > 0) {
      const targetCandidate = candidateHeadingIndices[Math.min(imgIdx, candidateHeadingIndices.length - 1)];
      if (targetCandidate !== undefined && !usedLineIndices.has(targetCandidate)) {
        bestLineIndex = targetCandidate;
      }
    }

    // 4. Distribute evenly across non-empty lines if still not matched
    if (bestLineIndex < 0) {
      const nonEmpty = lines.map((l, i) => ({ text: l.trim(), i })).filter((item) => item.text.length > 10);
      if (nonEmpty.length > 0) {
        const step = Math.floor(nonEmpty.length / (totalImages + 1));
        const chosen = nonEmpty[Math.min((imgIdx + 1) * step, nonEmpty.length - 1)];
        bestLineIndex = chosen ? chosen.i : Math.min(imgIdx * 4 + 2, lines.length - 1);
      } else {
        bestLineIndex = Math.min(imgIdx * 4 + 2, lines.length - 1);
      }
    }

    usedLineIndices.add(bestLineIndex);
    const group = mapped.get(bestLineIndex) || [];
    group.push(image);
    mapped.set(bestLineIndex, group);
  });

  return mapped;
}

export function assessProductLayout(components = [], placements = []) {
  const normalizedComponents = (Array.isArray(components) ? components : []).map((component) => ({
    type: String(component?.type || ''),
    text: String(component?.text || '').replace(/\s+/g, ' ').trim(),
    hrefs: Array.isArray(component?.hrefs) ? component.hrefs.map(String) : []
  }));
  let previousCardIndex = -1;
  const problems = [];

  (Array.isArray(placements) ? placements : []).forEach((placement, index) => {
    const anchor = String(placement?.anchor || '').replace(/\s+/g, ' ').trim();
    const url = String(placement?.url || '').trim();
    const anchorIndex = normalizedComponents.findIndex((component, componentIndex) => (
      componentIndex >= previousCardIndex && component.type === 'text' && anchor && component.text.includes(anchor)
    ));
    const imageIndex = normalizedComponents.findIndex((component, componentIndex) => (
      componentIndex > anchorIndex && component.type === 'image'
    ));
    const urlIndex = normalizedComponents.findIndex((component, componentIndex) => (
      componentIndex > imageIndex && component.type === 'text' && url
      && component.text.includes(url) && component.hrefs.some((href) => href === url || href.includes(url))
    ));
    if (anchorIndex < 0) problems.push(`상품 ${index + 1} 설명 위치 없음`);
    else if (imageIndex < 0) problems.push(`상품 ${index + 1} 사진 위치 없음`);
    else if (urlIndex < 0) problems.push(`상품 ${index + 1} 클릭 링크 위치 없음`);
    else previousCardIndex = urlIndex;
  });

  const imageCount = normalizedComponents.filter((component) => component.type === 'image').length;
  const cardCount = normalizedComponents.filter((component) => component.type === 'oglink').length;
  if (imageCount !== placements.length) problems.push(`사진 수 불일치: ${imageCount}/${placements.length}`);
  if (cardCount !== 0) problems.push(`불필요한 링크 카드: ${cardCount}개`);
  return { ok: problems.length === 0, problems, imageCount, cardCount };
}

async function verifyEditorProductLayout(page, editorFrame, content, images = []) {
  if (!images.length) return;
  await page.waitForTimeout(2500);
  const source = String(content || '');
  const placements = images.map((image) => {
    const anchor = String(image?.afterHeading || '').trim();
    const anchorOffset = anchor ? source.indexOf(anchor) : -1;
    const remaining = anchorOffset >= 0 ? source.slice(anchorOffset + anchor.length) : '';
    const url = remaining.match(/https?:\/\/[^\s]+/)?.[0] || '';
    return { anchor, url };
  });
  if (placements.some((placement) => !placement.anchor || !placement.url)) {
    throw new Error('상품별 사진과 링크의 기준 위치를 만들지 못해 발행을 중단했습니다.');
  }
  const components = await editorFrame.evaluate(() => Array.from(document.querySelectorAll('.se-components-wrap > .se-component, .se-main-container > .se-component'))
    .filter((component, index, all) => all.indexOf(component) === index && !component.classList.contains('se-documentTitle'))
    .map((component) => ({
      type: component.classList.contains('se-image') ? 'image'
        : (component.classList.contains('se-oglink') ? 'oglink'
          : (component.classList.contains('se-text') ? 'text' : 'other')),
      text: (component.innerText || component.textContent || '').replace(/\s+/g, ' ').trim(),
      hrefs: Array.from(component.querySelectorAll('.se-text-paragraph .se-link, .se-text-paragraph a[href]'))
        .map((element) => element.getAttribute('data-href') || element.getAttribute('href') || '')
        .filter(Boolean)
    })));
  const result = assessProductLayout(components, placements);
  if (!result.ok) {
    console.error('EDITOR_LAYOUT_DEBUG', JSON.stringify(components.map((component, index) => ({
      index,
      type: component.type,
      text: component.text.slice(0, 180),
      hrefs: component.hrefs.slice(0, 2)
    }))));
    throw new Error(`사진·글·링크 순서 검증에 실패해 발행을 중단했습니다: ${result.problems.join(', ')}`);
  }
}

async function dismissEditorPopups(page, editorFrame) {
  await page.keyboard.press('Escape').catch(() => {});
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const popups = editorFrame.locator('.se-popup-button-cancel, .se-popup-alert button:has-text("취소"), .se-help-panel-close-button, .se-popup-button-confirm');
    const count = await popups.count().catch(() => 0);
    let clicked = false;
    for (let index = 0; index < count; index += 1) {
      const button = popups.nth(index);
      if (await button.isVisible().catch(() => false)) {
        await button.click({ force: true }).catch(() => {});
        clicked = true;
      }
    }
    if (!clicked) break;
    await page.waitForTimeout(250);
  }
}

async function clearEditorBody(page, editorFrame) {
  const bodyParagraph = editorFrame.locator('.se-components-wrap .se-component.se-text .se-text-paragraph, .se-main-container .se-component.se-text .se-text-paragraph, .se-content .se-component.se-text .se-text-paragraph').first();
  if (await bodyParagraph.count().catch(() => 0) === 0) throw new Error('기존 본문을 선택하지 못했습니다.');
  await bodyParagraph.click({ force: true }).catch(() => bodyParagraph.dispatchEvent('click'));
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);

  let remaining = await inspectEditorBody(editorFrame);
  if (remaining.text || remaining.media) {
    const selected = await editorFrame.evaluate(() => {
      const root = document.querySelector('.se-components-wrap, .se-main-container, .se-content');
      if (!root) return false;
      const components = Array.from(root.querySelectorAll(':scope > .se-component'))
        .filter((component) => !component.classList.contains('se-documentTitle'));
      if (!components.length) return false;
      const range = document.createRange();
      range.setStartBefore(components[0]);
      range.setEndAfter(components[components.length - 1]);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return !selection.isCollapsed;
    }).catch(() => false);
    if (selected) {
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(700);
      remaining = await inspectEditorBody(editorFrame);
    }
  }
  if (remaining.text || remaining.media) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const lastComponent = editorFrame.locator('.se-components-wrap > .se-component:not(.se-documentTitle), .se-main-container > .se-component:not(.se-documentTitle)').last();
      if (await lastComponent.count().catch(() => 0) === 0) break;
      await lastComponent.click({ force: true }).catch(() => {});
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.keyboard.press('Delete').catch(() => {});
      await page.waitForTimeout(100);
      remaining = await inspectEditorBody(editorFrame);
      if (!remaining.text && !remaining.media) break;
    }
  }
  if (remaining.text || remaining.media) {
    throw new Error(`기존 본문 전체를 지우지 못했습니다. 남은 텍스트: ${remaining.text.slice(0, 160) || '없음'}, 남은 미디어: ${remaining.media}개`);
  }
}

async function inspectEditorBody(editorFrame) {
  return editorFrame.evaluate(() => {
    const components = Array.from(document.querySelectorAll('.se-components-wrap .se-component:not(.se-documentTitle)'));
    return {
      text: components.flatMap((component) => Array.from(component.querySelectorAll('.se-text-paragraph')))
        .map((paragraph) => {
          const copy = paragraph.cloneNode(true);
          copy.querySelectorAll('.se-placeholder, .__se_placeholder').forEach((placeholder) => placeholder.remove());
          return copy.innerText || copy.textContent || '';
        })
        .join('\n').replace(/\s+/g, ' ').trim(),
      media: components.filter((component) => component.matches('.se-image, .se-oglink, .se-video, .se-file')).length
    };
  }).catch(() => ({ text: '', media: 0 }));
}

function normalizePlacementText(value) {
  return String(value || '')
    .replace(/^\s*\d+\s*(?:위|\.)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function editorHeadingText(value) {
  return String(value || '')
    .replace(/^\s*(\d+)\s*위\s*[.\-]?\s*/i, '$1. ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function focusEditorInsertionPoint(editorFrame, image) {
  return editorFrame.evaluate(({ heading, title }) => {
    const root = document.querySelector('.se-components-wrap, .se-main-container, .se-content');
    if (!root) return { found: false, reason: 'editor_root' };
    const normalize = (value) => String(value || '')
      .replace(/^\s*\d+\s*(?:위|\.)\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let current;
    while ((current = walker.nextNode())) {
      const text = String(current.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (text) nodes.push({ node: current, text });
    }

    const expected = normalize(heading);
    const expectedTitle = normalize(title);
    const candidates = nodes.map((entry, index) => {
      const normalized = normalize(entry.text);
      let score = 0;
      if (expected && normalized === expected) score += 300;
      if (expectedTitle && normalized.includes(expectedTitle)) score += 50;
      if (/^\d+\.\s*\[[^\]]+\]/.test(entry.text)) score += 150;
      const following = nodes.slice(index + 1, index + 6).map((item) => item.text).join('\n');
      if (/(?:^|\n)판매처\s*:/.test(following)) score += 100;
      if (/(?:^|\n)가격\s*:/.test(following)) score += 100;
      return { ...entry, score };
    }).filter((entry) => entry.score >= 200).sort((a, b) => b.score - a.score);

    const selected = candidates[0];
    if (!selected) return { found: false, reason: 'heading_text' };
    const editable = selected.node.parentElement?.closest('[contenteditable="true"]');
    if (!editable) return { found: false, reason: 'contenteditable' };
    editable.focus();
    const range = document.createRange();
    range.setStart(selected.node, selected.node.nodeValue.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return { found: true, text: selected.text };
  }, {
    heading: editorHeadingText(image.afterHeading),
    title: image.title
  }).catch(() => ({ found: false, reason: 'evaluate' }));
}

async function focusEditorEnd(editorFrame) {
  return editorFrame.evaluate(() => {
    const root = document.querySelector('.se-components-wrap, .se-main-container, .se-content');
    if (!root) return { found: false, reason: 'editor_root' };
    const editables = Array.from(root.querySelectorAll('[contenteditable="true"]'))
      .filter((element) => element.getClientRects().length > 0);
    const editable = editables[editables.length - 1];
    if (!editable) return { found: false, reason: 'contenteditable' };
    editable.focus();
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return { found: true, fallback: true };
  }).catch(() => ({ found: false, reason: 'evaluate' }));
}

async function focusEditorEndWithKeyboard(page, editorFrame) {
  const paragraphs = editorFrame.locator('.se-components-wrap .se-component.se-text .se-text-paragraph, .se-main-container .se-component.se-text .se-text-paragraph, .se-content .se-component.se-text .se-text-paragraph');
  const count = await paragraphs.count().catch(() => 0);
  if (!count) return { found: false, reason: 'paragraph' };
  try {
    await paragraphs.nth(count - 1).click({ force: true });
    await page.keyboard.press('Control+End');
    return { found: true, fallback: 'keyboard_end' };
  } catch {
    return { found: false, reason: 'keyboard_end' };
  }
}

export function isProductSectionCandidate(text, followingTexts, normalizedTitle) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  const title = normalizePlacementText(normalizedTitle);
  if (!title || !/^\d+\.\s+/.test(line) || !normalizePlacementText(line).includes(title)) return false;
  const following = (Array.isArray(followingTexts) ? followingTexts : []).join('\n');
  return /(?:^|\n)판매처\s*:/.test(following) && /(?:^|\n)가격\s*:/.test(following);
}

function escapeHtmlForEditor(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function uploadEditorImages(page, editorFrame, imagePaths) {
  if (!imagePaths || !imagePaths.length) return 0;
  const validPaths = imagePaths.filter((p) => typeof p === 'string' && existsSync(p));
  if (validPaths.length !== imagePaths.length) throw new Error('업로드할 상품 이미지 파일을 찾지 못했습니다.');

  const beforeCount = await countEditorImages(editorFrame);
  const imageButtons = editorFrame.locator('button[data-name="image"], button.se-image-toolbar-button, button.se-toolbar-item-image button');
  const buttonCount = await imageButtons.count().catch(() => 0);
  if (!buttonCount) throw new Error('네이버 에디터의 사진 버튼을 찾지 못했습니다.');
  let imageBtn = null;
  for (let index = 0; index < buttonCount; index += 1) {
    const candidate = imageButtons.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      imageBtn = candidate;
      break;
    }
  }
  if (!imageBtn) throw new Error('네이버 에디터에서 보이는 사진 버튼을 찾지 못했습니다.');

  let fileChooser = null;
  for (let attempt = 0; attempt < 2 && !fileChooser; attempt += 1) {
    await page.keyboard.press('Escape').catch(() => {});
    [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
      imageBtn.click({ force: true }).catch(() => imageBtn.dispatchEvent('click'))
    ]);
    if (!fileChooser) await page.waitForTimeout(300);
  }
  if (!fileChooser) throw new Error('네이버 에디터의 이미지 선택 창이 열리지 않았습니다.');
  await fileChooser.setFiles(validPaths);

  const expectedCount = beforeCount + validPaths.length;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.waitForTimeout(500);
    const currentCount = await countEditorImages(editorFrame);
    if (currentCount >= expectedCount) return currentCount;
  }
  const finalCount = await countEditorImages(editorFrame);
  throw new Error(`상품 이미지 업로드를 확인하지 못했습니다. 네이버 에디터 이미지 수 ${beforeCount}→${finalCount}, 예상 ${expectedCount}장입니다.`);
}

async function countEditorImages(editorFrame) {
  return editorFrame.locator([
    '.se-canvas img',
    '.se-content img',
    '.se-main-container img',
    '.se-main-container .se-component.se-image',
    '.se-main-container .se-component[class*="image"]',
    '.se-main-container .se-module-image',
    '.se-main-container img.se-image-resource',
    '.se-main-container img[data-linkdata]',
    '[data-module="image"] img',
    'img[class*="image-resource"]'
  ].join(', ')).count().catch(() => 0);
}

function extractPublishedUrl(page, frame) {
  const candidates = [frame?.url(), page.url()].filter(Boolean);
  return candidates.find((url) => /PostView\.naver|[?&]logNo=\d+/i.test(url)) || page.url();
}

function maskId(id) {
  if (!id) return '';
  if (id.length <= 2) return `${id[0] || ''}*`;
  return `${id.slice(0, 2)}${'*'.repeat(Math.min(id.length - 2, 6))}`;
}
