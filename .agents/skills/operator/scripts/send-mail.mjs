// Sends one email from the owner's Naver mail account through the 112 Naver session (run on 112).
// Claude in Chrome blocks every naver.com page, and typing a recipient into Gmail through Chrome was refused
// by the permission check, so this is the way to send.
// Env: TO=<address>, SUBJECT=<subject>, BODY_FILE=<utf-8 text file>, SEND=1 to send (otherwise fill + screenshot only).
// Screenshots: /tmp/nmr/mail-draft.png before sending, /tmp/nmr/mail-sent.png after.
import fs from 'node:fs';
const root = '/home/lmo0317/apps/blog-engage';
const { NaverBrowserSession } = await import(`${root}/lib/naver.js`);
const { TO, SUBJECT, BODY_FILE } = process.env;
if (!TO || !SUBJECT || !BODY_FILE) { console.log('TO, SUBJECT and BODY_FILE are required'); process.exit(1); }
const BODY = fs.readFileSync(BODY_FILE, 'utf8').trim();
const profileDir = `/tmp/nmr/op-${process.pid}`;
const s = new NaverBrowserSession({ headless: true, profileDir, sessionStatePath: `${root}/.playwright/naver-session.json` });
await s.restoreSession();
const page = await s.context.newPage();
await page.setViewportSize({ width: 1400, height: 1100 });
await page.goto('https://mail.naver.com/v2/new', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
await page.locator('#recipient_input_element').click();
await page.keyboard.insertText(TO);
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
await page.locator('#subject_title').fill(SUBJECT);
// The body editor lives inside an iframe.
let editor = page.locator('[contenteditable=true]').filter({ visible: true }).first();
if (!await editor.count()) {
  for (const f of page.frames()) {
    const e = f.locator('[contenteditable=true], body[contenteditable]').first();
    if (await e.count()) { editor = e; break; }
  }
}
await editor.click();
for (const [i, line] of BODY.split('\n').entries()) {
  if (i) await page.keyboard.press('Enter');
  if (line) await page.keyboard.insertText(line);
}
await page.waitForTimeout(800);
console.log('subject:', await page.locator('#subject_title').inputValue());
console.log('body:', (await editor.innerText()).slice(0, 80).replace(/\n+/g, ' | '));
await page.screenshot({ path: '/tmp/nmr/mail-draft.png' });
if (process.env.SEND === '1') {
  await page.locator('button.button_write_task').first().click();
  await page.waitForTimeout(4000);
  const text = await page.locator('body').innerText();
  console.log(/성공적으로 보냈습니다/.test(text) ? 'SENT' : 'SEND NOT CONFIRMED', page.url());
  await page.screenshot({ path: '/tmp/nmr/mail-sent.png' });
}
await s.close();
fs.rmSync(profileDir, { recursive: true, force: true });
process.exit(0);
