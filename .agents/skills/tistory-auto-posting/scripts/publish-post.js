#!/usr/bin/env node
// Tistory publisher. The Tistory Open API was shut down in Feb 2024, so this
// drives the real editor (/manage/newpost) in a persistent Chrome profile.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { contentToHtml, planSegments } from './content-to-html.js';
import { importNaverPost } from './import-naver-post.js';

const ROOT = 'D:/work/dev/blog';
const PROFILE_DIR = `${ROOT}/.playwright/tistory-profile`;
const CONFIG_PATH = `${ROOT}/.data/tistory.json`;
// TSSESSION is a session cookie, so Chrome drops it when the profile closes.
const SESSION_PATH = `${ROOT}/.data/tistory-session.json`;
const DEBUG_DIR = `${ROOT}/output/tistory-debug`;
const BACKUP_DIR = `${ROOT}/output/tistory-backup`;
const INDEX_PATH = `${ROOT}/.agents/skills/tistory-auto-posting/references/published-posts/INDEX.md`;
const VISIBILITY = { public: '20', protected: '15', private: '0' };
const VISIBILITY_LABEL = { public: '공개', protected: '보호', private: '비공개' };

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    login: false,
    title: '',
    contentFile: '',
    category: '',
    tags: [],
    imagesFile: '',
    blog: process.env.TISTORY_BLOG || '',
    visibility: '',
    postId: '',
    fromNaver: '',
    dryRun: false,
    headless: false
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => args[++i];
    if (arg === '--login') options.login = true;
    else if (arg === '--title') options.title = next();
    else if (arg === '--content-file') options.contentFile = next();
    else if (arg === '--category') options.category = next();
    else if (arg === '--tags') options.tags = next().split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    else if (arg === '--images-file') options.imagesFile = next();
    else if (arg === '--blog') options.blog = next();
    else if (arg === '--visibility') options.visibility = next();
    else if (arg === '--post-id') options.postId = next();
    else if (arg === '--from-naver') options.fromNaver = next();
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--headless') options.headless = true;
  }
  // New posts default to public; updates keep the post's current visibility.
  if (!options.visibility && !options.postId) options.visibility = 'public';
  if (options.visibility && !VISIBILITY[options.visibility]) throw new Error(`--visibility must be one of ${Object.keys(VISIBILITY).join(', ')}`);
  return options;
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function writeConfig(patch) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...readConfig(), ...patch }, null, 2));
}

async function openContext(headless) {
  const options = {
    headless,
    channel: 'chrome',
    viewport: null,
    locale: 'ko-KR',
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized', '--lang=ko-KR'],
    ignoreDefaultArgs: ['--enable-automation']
  };
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, options);
  } catch {
    delete options.channel;
    context = await chromium.launchPersistentContext(PROFILE_DIR, options);
  }
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await restoreSession(context);
  return context;
}

async function saveSession(context) {
  const cookies = (await context.cookies()).filter((c) => /tistory\.com|kakao\.com/.test(c.domain));
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify(cookies, null, 2));
}

async function restoreSession(context) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8')); } catch { return; }
  const existing = new Set((await context.cookies()).map((c) => `${c.domain}|${c.name}`));
  const keepUntil = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const now = Math.floor(Date.now() / 1000);
  // One expired entry makes addCookies reject the whole batch, so drop them first.
  const missing = saved
    .filter((c) => !existing.has(`${c.domain}|${c.name}`) && !(c.expires > 0 && c.expires < now))
    .map((c) => ({ ...c, expires: c.expires > 0 ? c.expires : keepUntil }));
  if (missing.length) await context.addCookies(missing).catch(() => {});
}

async function hasSessionCookie(context) {
  const check = async () => (await context.cookies('https://www.tistory.com')).some((c) => c.name === 'TSSESSION' && c.value);
  if (await check()) return true;
  // A freshly launched profile may not expose its cookie store until the first page load.
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.tistory.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  return check();
}

function isAuthUrl(url) {
  return /tistory\.com\/auth\/login|accounts\.kakao\.com|kauth\.kakao\.com/i.test(url);
}

async function detectBlogs(page) {
  await page.goto('https://www.tistory.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
  const names = new Set();
  for (const href of hrefs) {
    const m = href.match(/^https:\/\/([a-z0-9-]+)\.tistory\.com\/manage/i);
    if (m && m[1] !== 'www') names.add(m[1].toLowerCase());
  }
  return [...names];
}

// A TSSESSION cookie can outlive the server-side session, so confirm by opening the manage page.
async function sessionIsValid(context, page, blog) {
  if (!await hasSessionCookie(context)) return false;
  const target = blog ? `https://${blog}.tistory.com/manage` : 'https://www.tistory.com/';
  await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1000);
  if (isAuthUrl(page.url())) return false;
  return blog ? true : (await detectBlogs(page)).length > 0;
}

async function runLogin(context, options) {
  const page = context.pages()[0] || await context.newPage();
  const blog = options.blog || readConfig().blog || '';
  if (!await sessionIsValid(context, page, blog)) {
    await context.clearCookies({ domain: /tistory\.com$/ }).catch(() => context.clearCookies());
    await page.goto('https://www.tistory.com/auth/login', { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    console.log('[tistory] 열린 Chrome 창에서 카카오 계정으로 티스토리에 로그인해 주세요. (최대 10분 대기)');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      if (await hasSessionCookie(context) && !isAuthUrl(page.url())) break;
    }
    if (!await sessionIsValid(context, page, blog)) throw new Error('로그인 대기 시간이 지났습니다. 다시 --login 으로 시도해 주세요.');
  }
  console.log('[tistory] 로그인 확인됨.');
  await saveSession(context);

  const blogs = options.blog ? [options.blog] : await detectBlogs(page);
  if (blogs.length) {
    writeConfig({ blog: blogs[0], blogs });
    console.log(`[tistory] 블로그: ${blogs.join(', ')} (기본값 ${blogs[0]} 저장)`);
  } else {
    console.log('[tistory] 블로그 이름을 찾지 못했습니다. 발행 시 --blog <이름> 을 지정해 주세요. (https://<이름>.tistory.com)');
  }
}

async function firstVisible(scope, selectors, timeout = 0) {
  const deadline = Date.now() + timeout;
  do {
    for (const selector of selectors) {
      const locator = scope.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        if (await locator.nth(i).isVisible().catch(() => false)) return locator.nth(i);
      }
    }
    if (Date.now() < deadline) await scope.waitForTimeout?.(300);
  } while (Date.now() < deadline);
  return null;
}

async function saveDebug(page, label) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const shot = `${DEBUG_DIR}/${stamp}-${label}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    const controls = await page.evaluate(() => [...document.querySelectorAll('button, input, textarea, [role="button"], [role="option"]')]
      .filter((el) => el.offsetParent !== null)
      .slice(0, 150)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''} "${(el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 30)}"`));
    fs.writeFileSync(`${DEBUG_DIR}/${stamp}-${label}.txt`, `${page.url()}\n\n${controls.join('\n')}`);
    console.error(`[tistory] 디버그 저장: ${shot}`);
  } catch {}
}

async function editorImageCount(page) {
  return page.evaluate(() => {
    const ed = window.tinymce?.activeEditor;
    if (!ed) return 0;
    // WYSIWYG shows <img>, the saved markup uses [##_Image|...##]; take whichever sees more.
    return Math.max(ed.getBody().querySelectorAll('img').length, (ed.getContent().match(/\[##_Image\|/g) || []).length);
  });
}

async function moveCursorToEnd(page) {
  await page.evaluate(() => {
    const ed = window.tinymce.activeEditor;
    ed.focus();
    ed.selection.select(ed.getBody(), true);
    ed.selection.collapse(false);
  });
}

async function insertHtml(page, html) {
  await moveCursorToEnd(page);
  await page.evaluate((value) => window.tinymce.activeEditor.insertContent(value), html);
}

async function uploadImage(page, filePath) {
  const before = await editorImageCount(page);
  await moveCursorToEnd(page);

  let uploaded = false;
  const attachButton = await firstVisible(page, [
    '#mceu_0 button', 'button[aria-label="첨부"]', '[aria-label="첨부"]', '.mce-btn:has-text("첨부")', 'button:has-text("첨부")'
  ]);
  if (attachButton) {
    await attachButton.click();
    const photoItem = await firstVisible(page, [
      '#attach-image', '.mce-menu-item:has-text("사진")', '[role="menuitem"]:has-text("사진")', 'text="사진"'
    ], 3000);
    if (photoItem) {
      const chooser = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
      await photoItem.click();
      const fileChooser = await chooser;
      if (fileChooser) {
        await fileChooser.setFiles(filePath);
        uploaded = true;
      }
    }
  }
  if (!uploaded) {
    await page.keyboard.press('Escape').catch(() => {});
    const input = page.locator('input[type="file"][accept*="image"], input[type="file"]').first();
    if (await input.count() === 0) throw new Error('티스토리 이미지 업로드 입력을 찾지 못했습니다.');
    await input.setInputFiles(filePath);
  }

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(700);
    if (await editorImageCount(page) > before) return;
  }
  throw new Error(`이미지 업로드가 본문에 반영되지 않았습니다: ${path.basename(filePath)}`);
}

async function selectCategory(page, name) {
  const button = await firstVisible(page, ['#category-btn', 'button:has-text("카테고리")'], 5000);
  if (!button) throw new Error('카테고리 버튼을 찾지 못했습니다.');
  await button.click();
  await page.waitForTimeout(500);
  const items = page.locator('#category-list [role="option"], #category-list .mce-menu-item, #category-list li, [role="listbox"] [role="option"]');
  const count = await items.count();
  const available = [];
  for (let i = 0; i < count; i++) {
    const text = (await items.nth(i).innerText().catch(() => '')).trim().replace(/^-\s*/, '');
    available.push(text);
    if (text === name) {
      await items.nth(i).click();
      await page.waitForTimeout(300);
      return;
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  throw new Error(`카테고리 "${name}"를 찾지 못했습니다. 사용 가능: ${available.filter(Boolean).join(', ') || '(목록 없음)'}`);
}

async function addTags(page, tags) {
  if (!tags.length) return;
  const input = await firstVisible(page, ['#tagText', 'input[placeholder*="태그"]'], 3000);
  if (!input) throw new Error('태그 입력란을 찾지 못했습니다.');
  for (const tag of tags.slice(0, 10)) {
    await input.click();
    await input.fill(tag);
    await input.press('Enter');
    await page.waitForTimeout(150);
  }
}

async function backupExistingPost(page, titleInput, postId) {
  const title = await titleInput.inputValue();
  if (!title.trim()) throw new Error(`글 ${postId}을(를) 불러오지 못했습니다. 글 번호를 확인해 주세요.`);
  const content = await page.evaluate(() => window.tinymce.activeEditor.getContent());
  const tags = await page.evaluate(() => [...document.querySelectorAll('.editor_tag .txt_tag > a:first-child')].map((el) => el.innerText.trim().replace(/^#/, '')).filter(Boolean));
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = `${BACKUP_DIR}/${postId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(file, JSON.stringify({ postId, url: page.url(), title, tags, content }, null, 2));
  console.log(`[tistory] 기존 글 백업: ${file} ("${title}")`);
}

async function clearTags(page) {
  // Existing tag chips: <span class="txt_tag"><a>#tag</a><a class="btn_delete">.
  for (let i = 0; i < 30; i++) {
    const remove = await firstVisible(page, [
      '.editor_tag .txt_tag .btn_delete'
    ]);
    if (!remove) return;
    await remove.click().catch(() => {});
    await page.waitForTimeout(120);
  }
}

async function setRepresentativeImage(page, filePath) {
  const remove = page.locator('.box_thumb .ico_delete');
  if (await remove.isVisible().catch(() => false)) {
    await remove.click();
    await page.waitForTimeout(400);
  }
  const input = page.locator('.box_thumb input[type="file"]');
  if (await input.count() === 0) throw new Error('대표이미지 입력을 찾지 못했습니다.');
  await input.setInputFiles(filePath);
  await page.locator('.box_thumb .thumb_g').waitFor({ timeout: 30000 });
  console.log(`[tistory] 대표이미지 변경: ${path.basename(filePath)}`);
}

async function chooseVisibility(page, visibility) {
  const value = VISIBILITY[visibility];
  const label = VISIBILITY_LABEL[visibility];
  const radio = await firstVisible(page, [`#open${value}`, `input[type="radio"][value="${value}"]`], 1500);
  if (radio) {
    await radio.check({ force: true }).catch(() => radio.click({ force: true }));
    return;
  }
  const labelEl = page.getByText(label, { exact: true }).first();
  if (await labelEl.count()) {
    await labelEl.click();
    return;
  }
  throw new Error(`공개 설정(${label}) 선택지를 찾지 못했습니다.`);
}

async function findPostUrl(page, blog, title) {
  const base = `https://${blog}.tistory.com`;
  // Tistory usually redirects to the manage list after publishing.
  for (const target of [`${base}/manage/posts/`, `${base}/rss`]) {
    try {
      if (target.endsWith('/rss')) {
        const xml = await (await fetch(target)).text();
        const items = xml.split('<item>').slice(1);
        const hit = items.find((item) => item.includes(title));
        const link = hit?.match(/<link>([^<]+)<\/link>/)?.[1];
        if (link) return link.trim();
      } else {
        await page.goto(target, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        const link = await page.$$eval('a[href]', (as, args) => {
          const [t, b] = args;
          const re = new RegExp(`^${b.replace(/\./g, '\\.')}/(\\d+|entry/)`);
          const a = as.find((el) => re.test(el.href) && el.innerText.trim().includes(t));
          return a?.href || '';
        }, [title.slice(0, 40), base]);
        if (link) return link;
      }
    } catch {}
  }
  return '';
}

async function verifyPublic(url, title, expectedImages) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await res.text();
  const titleOk = html.includes(title.slice(0, 20));
  const imageCount = (html.match(/<figure class="imageblock/g) || []).length;
  return { status: res.status, titleOk, imageCount, imagesOk: imageCount >= expectedImages };
}

function appendIndex({ title, url, category, tags, visibility }) {
  if (!fs.existsSync(INDEX_PATH)) return;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const postId = url.match(/tistory\.com\/(\d+|entry\/[^?#]+)/)?.[1] || 'link';
  const row = `| ${stamp} | ${title.replace(/\|/g, '/')} | ${category || '-'} | ${tags.join(', ') || '-'} | ${VISIBILITY_LABEL[visibility]} | [${decodeURIComponent(postId)}](${url}) |\n`;
  fs.appendFileSync(INDEX_PATH, row, 'utf8');
}

async function publish(context, options) {
  const content = fs.readFileSync(path.resolve(options.contentFile), 'utf8');
  const images = options.imagesFile
    ? JSON.parse(fs.readFileSync(path.resolve(options.imagesFile), 'utf8')).map((img) => ({ ...img, filePath: img.filePath || img.path }))
    : [];
  const missing = images.filter((img) => !img.filePath || !fs.existsSync(img.filePath));
  if (missing.length) throw new Error(`이미지 파일이 없습니다: ${missing.map((m) => m.filePath).join(', ')}`);

  const html = contentToHtml(content, { headingHints: images.map((img) => img.afterHeading).filter(Boolean) });
  const { segments, unmatched } = planSegments(html, images);
  if (unmatched.length) console.warn(`[tistory] afterHeading과 맞는 소제목이 없어 본문 끝에 붙일 이미지: ${unmatched.map((u) => path.basename(u.filePath)).join(', ')}`);

  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'beforeunload') {
      dialog.accept().catch(() => {});
      return;
    }
    // "작성 중인 글이 있습니다. 이어서 작성하시겠습니까?" -> start fresh.
    console.log(`[tistory] 대화상자 닫음: ${dialog.message()}`);
    dialog.dismiss().catch(() => {});
  });

  const base = `https://${options.blog}.tistory.com`;
  const editorUrl = options.postId
    ? `${base}/manage/newpost/${options.postId}?type=post&returnURL=ENTRY`
    : `${base}/manage/newpost/?type=post`;
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
  if (isAuthUrl(page.url())) {
    return { status: 'login_required', message: '티스토리 로그인이 필요합니다. 먼저 --login 을 실행해 주세요.' };
  }
  await page.waitForFunction(() => window.tinymce?.activeEditor?.initialized, null, { timeout: 30000 });
  await page.waitForTimeout(800);

  const titleInput = await firstVisible(page, ['#post-title-inp', 'textarea[placeholder*="제목"]', 'input[placeholder*="제목"]'], 5000);
  if (!titleInput) throw new Error('제목 입력란을 찾지 못했습니다.');
  if (options.postId) await backupExistingPost(page, titleInput, options.postId);

  if (options.category) await selectCategory(page, options.category);
  await titleInput.fill(options.title);

  await page.evaluate(() => window.tinymce.activeEditor.setContent(''));
  for (const segment of segments) {
    if (segment.html.trim()) await insertHtml(page, segment.html);
    for (const image of segment.images) {
      console.log(`[tistory] 이미지 업로드: ${path.basename(image.filePath)}`);
      await uploadImage(page, image.filePath);
    }
  }
  const insertedImages = await editorImageCount(page);
  console.log(`[tistory] 본문 입력 완료 (이미지 ${insertedImages}/${images.length})`);

  if (options.postId && options.tags.length) await clearTags(page);
  await addTags(page, options.tags);

  const completeButton = await firstVisible(page, ['#publish-layer-btn', 'button:has-text("완료")'], 5000);
  if (!completeButton) throw new Error('완료(발행 설정) 버튼을 찾지 못했습니다.');
  await completeButton.click();
  await page.waitForTimeout(1200);
  if (options.visibility) await chooseVisibility(page, options.visibility);
  // New posts pick the first body image automatically; an edited post keeps its old thumbnail.
  if (options.postId && images.length) await setRepresentativeImage(page, images[0].filePath);

  if (options.dryRun) {
    await saveDebug(page, 'dry-run');
    const editorHtml = await page.evaluate(() => window.tinymce.activeEditor.getContent());
    fs.writeFileSync(`${DEBUG_DIR}/last-dry-run.html`, editorHtml);
    await page.bringToFront();
    console.log('[tistory] --dry-run: 발행 직전에서 멈췄습니다. 창에서 확인한 뒤 브라우저를 닫으면 종료됩니다.');
    await new Promise((resolve) => context.on('close', resolve));
    return { status: 'dry_run' };
  }

  const finalButton = await firstVisible(page, [
    '#publish-btn', '.layer_post button:has-text("발행")', 'button:has-text("공개 발행")', 'button:has-text("발행")', 'button:has-text("저장")'
  ], 5000);
  if (!finalButton) throw new Error('최종 발행 버튼을 찾지 못했습니다.');
  await finalButton.click();

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && /\/manage\/newpost/.test(page.url())) await page.waitForTimeout(500);
  if (/\/manage\/newpost/.test(page.url())) {
    await saveDebug(page, 'publish-stuck');
    return { status: 'manual_required', message: '발행 후 페이지가 넘어가지 않았습니다. 창을 확인해 주세요.' };
  }

  const url = options.postId ? `${base}/${options.postId}` : await findPostUrl(page, options.blog, options.title);
  const result = { status: options.postId ? 'updated' : 'published', url, visibility: options.visibility || 'unchanged', images: images.length };
  if (url && options.visibility !== 'private' && options.visibility !== 'protected') result.verify = await verifyPublic(url, options.title, images.length);
  return result;
}

async function main() {
  const options = parseArgs();
  if (!options.blog) options.blog = readConfig().blog || '';

  if (options.fromNaver) {
    // Title, body, images, and tags come from the Naver post unless given explicitly.
    const imported = await importNaverPost(options.fromNaver);
    console.log(`[tistory] 네이버 글 변환: "${imported.title}" (소제목 ${imported.headings}, 이미지 ${imported.images}, 태그 ${imported.tags.length})`);
    options.title ||= imported.title;
    options.contentFile ||= imported.contentFile;
    options.imagesFile ||= imported.imagesFile;
    if (!options.tags.length) options.tags = imported.tags;
  }

  if (!options.login && (!options.title || !options.contentFile)) {
    console.error(`Usage:
  node publish-post.js --login [--blog <name>]
  node publish-post.js --from-naver <naver post url> [--category <name>] [--post-id <id>] [--dry-run]
  node publish-post.js --title <title> --content-file <path> [--category <name>] [--tags a,b] [--images-file <images.json>]
                       [--blog <name>] [--visibility public|protected|private] [--post-id <id>] [--dry-run]`);
    process.exit(1);
  }

  const context = await openContext(options.headless);
  let page;
  try {
    if (options.login) {
      await runLogin(context, options);
      return;
    }
    if (!options.blog) throw new Error('블로그 이름이 없습니다. --login 을 먼저 실행하거나 --blog <이름> 을 지정해 주세요.');
    if (!await hasSessionCookie(context)) {
      console.log(JSON.stringify({ status: 'login_required', message: '티스토리 로그인이 필요합니다. 먼저 --login 을 실행해 주세요.' }, null, 2));
      process.exitCode = 2;
      return;
    }
    page = context.pages()[0];
    const result = await publish(context, options);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'published' && result.url) {
      appendIndex({ ...options, url: result.url });
      console.log(`\n발행 완료: ${result.url}`);
    }
    if (!['published', 'updated', 'dry_run'].includes(result.status)) process.exitCode = 2;
  } catch (error) {
    if (page || context.pages()[0]) await saveDebug(page || context.pages()[0], 'error');
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[tistory] 실패:', err.message);
  process.exit(1);
});
