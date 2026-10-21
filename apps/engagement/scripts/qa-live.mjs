// Live Naver QA, run on the 112 server by scripts/qa.mjs against the code about to ship (copied to a temp
// folder). It uses the owner's own blog only: one secret comment on the QA post, one reply under it, both
// checked on the real page and then deleted. Prints one JSON line: { ok, checks: [{ name, ok, detail }], leftovers }.
//   node qa-live.mjs <lib dir> <session json> <qa post url>
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , libDir, sessionPath, qaPostUrl, deleteOnly = ''] = process.argv;
const { NaverBrowserSession } = await import(pathToFileURL(path.join(libDir, 'naver.js')).href);

const checks = [];
const leftovers = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
const token = `QA${Date.now().toString(36)}`;
const logNo = qaPostUrl.match(/(\d{8,})/)?.[1];
const blogId = qaPostUrl.match(/naver\.com\/([^/?#]+)\//)?.[1];

const session = new NaverBrowserSession({ headless: true, profileDir: path.join(path.dirname(sessionPath), 'profile'), sessionStatePath: sessionPath });

// The comments under the QA post as the owner sees them (secret ones included).
async function readComments() {
  const page = await session.context.newPage();
  try {
    await page.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${blogId}&logNo=${logNo}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.locator('.u_cbox_comment').first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    return await page.$$eval('.u_cbox_comment', (els) => els.map((el) => ({
      no: ((el.getAttribute('data-info') || '').match(/commentNo:'(\d+)/) || [])[1] || '',
      parent: (((el.closest('.u_cbox_reply_area')?.closest('.u_cbox_comment')?.getAttribute('data-info')) || '').match(/commentNo:'(\d+)/) || [])[1] || '',
      text: (el.querySelector('.u_cbox_contents')?.textContent || '').replace(/\s+/g, ' ').trim()
    })));
  } finally {
    await page.close().catch(() => {});
  }
}

// Deletes one of the owner's comments by number (QA artifacts only).
async function deleteComment(no) {
  const page = await session.context.newPage();
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  try {
    await page.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${blogId}&logNo=${logNo}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.locator('.u_cbox_comment').first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const item = page.locator(`.u_cbox_comment[data-info*="commentNo:'${no}'"]`).first();
    // A reply sits in its parent's folded reply list, so the 삭제 link is hidden: fire Naver's own action on it
    // directly (data-action handlers are delegated); the browser confirm() is accepted above.
    await item.locator('a.u_cbox_btn_delete').first().dispatchEvent('click', {}, { timeout: 5000 });
    await page.waitForTimeout(800);
    const confirm = page.locator('.u_cbox_layer_btn button:has-text("확인"), .u_cbox_layer_wrap button:has-text("확인"), .u_cbox_layer_btn_wrap button:has-text("확인")').filter({ visible: true }).first();
    if (await confirm.isVisible().catch(() => false)) await confirm.click({ force: true });
    await page.waitForTimeout(1500);
  } finally {
    await page.close().catch(() => {});
  }
  return !(await readComments()).some((row) => row.no === no);
}

let commentNo = '';
let replyNo = '';
// Cleanup mode: delete leftover QA comments (numbers, comma separated), replies first.
if (deleteOnly) {
  await session.restoreSession();
  for (const no of deleteOnly.split(',').filter(Boolean)) {
    const gone = await deleteComment(no).catch(() => false);
    check(`QA 댓글 ${no} 삭제`, gone);
    if (!gone) leftovers.push(no);
  }
  await session.close().catch(() => {});
  console.log(JSON.stringify({ ok: checks.every((item) => item.ok), checks, leftovers }));
  process.exit(0);
}
try {
  const restored = await session.restoreSession();
  check('네이버 세션 복원', restored?.connected, JSON.stringify(restored));

  const scan = await session.scanMyBlogComments({ postLimit: 3 }).catch((error) => ({ error: error.message }));
  check('내 글 댓글 스캔', !scan.error && Array.isArray(scan.comments) && scan.scannedPosts > 0, scan.error || `posts ${scan.scannedPosts}, comments ${scan.comments?.length}`);

  const inspected = await session.inspectPostForEngagement(qaPostUrl).catch((error) => ({ error: error.message }));
  const snippet = String(inspected.contentSnippet || inspected.snippet || inspected.text || '');
  check('글 본문 읽기 (제목·메뉴 섞임 없음)', !inspected.error && snippet.length > 50 && !/이웃추가|본문 기타 기능/.test(snippet), inspected.error || snippet.slice(0, 80));

  const commentText = `QA 자동 점검용 비밀댓글입니다 ${token}`;
  const posted = await session.likeAndCommentPost({ postUrl: qaPostUrl, commentText, doLike: false, doComment: true, secret: true });
  check('비밀댓글 등록 (등록 버튼 클릭)', posted.commented, posted.commentReason);
  const afterComment = await readComments();
  const mine = afterComment.find((row) => row.text.includes(token) && !row.parent);
  commentNo = mine?.no || '';
  check('비밀댓글이 실제 페이지에 1개만 보임', afterComment.filter((row) => row.text.includes(token)).length === 1 && commentNo, `found ${afterComment.filter((row) => row.text.includes(token)).length}`);

  if (commentNo) {
    const replyText = `QA 자동 점검 답글 ${token}`;
    const replied = await session.replyToBlogComment({ postUrl: qaPostUrl, commentId: commentNo, commentText, replyText }).catch((error) => ({ error: error.message }));
    check('대댓글 등록 (등록 버튼 클릭)', replied.replied, replied.error || '');
    const afterReply = await readComments();
    const replies = afterReply.filter((row) => row.text.includes(`답글 ${token}`));
    replyNo = replies[0]?.no || '';
    check('대댓글이 그 댓글 아래 1개만 달림', replies.length === 1 && replies[0].parent === commentNo, JSON.stringify(replies));
    check('대댓글이 새 댓글로 따로 달리지 않음', !replies.some((row) => !row.parent));
    // The same comment asked again (a second run, a retry after a failed check) must not get a second reply.
    const again = await session.replyToBlogComment({ postUrl: qaPostUrl, commentId: commentNo, commentText, replyText: `QA 두 번째 답글 ${token}` }).catch((error) => ({ error: error.message }));
    check('이미 답한 댓글에는 두 번째 대댓글을 달지 않음', again.alreadyReplied && !again.replied, again.error || JSON.stringify(again));
    const extra = (await readComments()).filter((row) => row.text.includes(`두 번째 답글 ${token}`));
    check('두 번째 대댓글이 실제 페이지에 없음', extra.length === 0, extra.map((row) => row.no).join(','));
    for (const row of extra) await deleteComment(row.no).catch(() => false);
  }
} catch (error) {
  check('실행 중 예외', false, error.stack || error.message);
} finally {
  for (const no of [replyNo, commentNo].filter(Boolean)) {
    const gone = await deleteComment(no).catch(() => false);
    if (!gone) leftovers.push(`${qaPostUrl} 댓글 ${no}`);
  }
  await session.close().catch(() => {});
}

console.log(JSON.stringify({ ok: checks.every((item) => item.ok), checks, leftovers }));
process.exit(0);
