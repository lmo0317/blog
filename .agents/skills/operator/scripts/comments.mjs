// Lists comments on my Naver posts from the live mobile comment page (run on 112).
// Env: LOGNO=<post no> (or ALL=1 for the latest 30 posts), FIND=<regex on nick or text>, BLOG=<blogId, default lmo0317>.
// Prints commentNo, parent (for replies), whether it is mine, nick, date and text.
import fs from 'node:fs';
const root = '/home/lmo0317/apps/blog-engage';
const { NaverBrowserSession } = await import(`${root}/lib/naver.js`);
const blogId = process.env.BLOG || 'lmo0317';
const find = process.env.FIND ? new RegExp(process.env.FIND) : null;
const profileDir = `/tmp/nmr/op-${process.pid}`;
const s = new NaverBrowserSession({ headless: true, profileDir, sessionStatePath: `${root}/.playwright/naver-session.json` });
await s.restoreSession();
const page = await s.context.newPage();
let posts = process.env.LOGNO ? [process.env.LOGNO] : [];
if (process.env.ALL === '1') {
  await page.goto(`https://m.blog.naver.com/${blogId}`, { waitUntil: 'domcontentloaded' });
  posts = await page.evaluate(async (id) => {
    const r = await fetch(`/api/blogs/${id}/post-list?categoryNo=0&itemCount=30&page=1`, { credentials: 'include' });
    return ((await r.json())?.result?.items || []).map((i) => String(i.logNo));
  }, blogId);
}
for (const logNo of posts) {
  await page.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${blogId}&logNo=${logNo}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 10; i++) {
    const more = page.locator('.u_cbox_btn_more, .u_cbox_paginate a').first();
    if (!await more.isVisible().catch(() => false)) break;
    await more.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  const rows = await page.evaluate(() => [...document.querySelectorAll('li.u_cbox_comment')].map((li) => {
    const i = li.getAttribute('data-info') || '';
    return {
      no: i.match(/commentNo:'(\d+)'/)?.[1], parent: i.match(/parentCommentNo:'(\d+)'/)?.[1] || null,
      reply: /replyLevel:2/.test(i), mine: /mine:true/.test(i), deleted: /deleted:true/.test(i),
      nick: li.querySelector('.u_cbox_nick')?.textContent?.trim() || '',
      date: li.querySelector('.u_cbox_date')?.textContent?.trim() || '',
      text: li.querySelector('.u_cbox_contents')?.textContent?.trim() || ''
    };
  }));
  for (const r of rows.filter((r) => !r.deleted && (!find || find.test(`${r.nick} ${r.text}`)))) {
    console.log(`[${logNo}] ${r.reply ? '  └ ' : ''}${r.no}${r.reply ? ` (parent ${r.parent})` : ''}${r.mine ? ' [내 답글]' : ''} ${r.nick} ${r.date}\n    ${r.text}`);
  }
}
await s.close();
fs.rmSync(profileDir, { recursive: true, force: true });
process.exit(0);
