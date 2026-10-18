// Posts one reply in a comment thread on my Naver post (run on 112).
// Env: LOGNO=<post no>, PARENT=<commentNo of the thread's top comment>, TEXT=<reply>, DRY=1 to type without posting.
// Naver allows one reply level: answering a reply means replying in its parent's thread, so PARENT is the top comment.
// CommentList.naver now redirects to PostView with a comment panel. The reply editor is a contenteditable div
// inside the parent li's .u_cbox_reply_area; it appears after clicking that li's 답글 button once.
import fs from 'node:fs';
const root = '/home/lmo0317/apps/blog-engage';
const { NaverBrowserSession } = await import(`${root}/lib/naver.js`);
const { LOGNO, PARENT, TEXT } = process.env;
const blogId = process.env.BLOG || 'lmo0317';
if (!LOGNO || !PARENT || !TEXT) { console.log('LOGNO, PARENT and TEXT are required'); process.exit(1); }
const profileDir = `/tmp/nmr/op-${process.pid}`;
const s = new NaverBrowserSession({ headless: true, profileDir, sessionStatePath: `${root}/.playwright/naver-session.json` });
await s.restoreSession();
const page = await s.context.newPage();
page.on('dialog', (d) => d.accept().catch(() => {}));
const done = async (code) => { await s.close(); fs.rmSync(profileDir, { recursive: true, force: true }); process.exit(code); };
await page.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${blogId}&logNo=${LOGNO}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
for (let i = 0; i < 10; i++) {
  const more = page.locator('.u_cbox_btn_more, .u_cbox_paginate a').first();
  if (!await more.isVisible().catch(() => false)) break;
  await more.click().catch(() => {});
  await page.waitForTimeout(1200);
}
const li = page.locator(`li.u_cbox_comment[data-info*="commentNo:'${PARENT}'"]`).first();
if (!await li.count()) { console.log('parent comment not found'); await done(1); }
const box = li.locator('.u_cbox_reply_area [contenteditable=true]').first();
if (!await box.isVisible().catch(() => false)) {
  await li.locator('.u_cbox_btn_reply').first().click({ force: true });
  await page.waitForTimeout(2000);
}
if (!await box.isVisible().catch(() => false)) { console.log('reply editor did not open'); await done(1); }
await box.click({ force: true });
await page.keyboard.insertText(TEXT);
await page.waitForTimeout(800);
console.log('typed:', (await box.textContent()).slice(0, 60));
if (process.env.DRY !== '1') {
  await li.locator('.u_cbox_reply_area .u_cbox_btn_upload').first().click({ force: true });
  await page.waitForTimeout(4000);
  const mine = await page.evaluate((p) => [...document.querySelectorAll('li.u_cbox_comment')]
    .filter((l) => { const i = l.getAttribute('data-info') || ''; return i.includes(`parentCommentNo:'${p}'`) && /mine:true/.test(i); })
    .map((l) => l.querySelector('.u_cbox_contents')?.textContent?.trim()), PARENT);
  const ok = mine.some((t) => t && t.replace(/\s/g, '').startsWith(TEXT.replace(/\s/g, '').slice(0, 15)));
  console.log(ok ? 'POSTED' : 'NOT FOUND AFTER POST', JSON.stringify(mine));
}
await done(0);
