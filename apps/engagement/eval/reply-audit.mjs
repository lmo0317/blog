// Audit of every reply I (the owner) have under visitor comments, read from the real blog (a scan json from
// fix-replies.mjs): which ones read as a bot or answer the wrong thing, and what the current system would write.
// Replies that carry real information (a mail sent, an update, a link) or answer a question or request are the
// owner's and are never touched.
// usage: node eval/reply-audit.mjs <scan json> <plan out json> [llama url]
import fs from 'node:fs';
import { checkReply, classifyComment } from '../lib/comment-harness.js';
import { normalizeCommentText } from '../lib/comment-prompt.js';
import { EmbeddedLlamaServer } from '../lib/embedded-llama.js';

const [, , scanFile, planFile, url = 'http://192.168.219.112:8081'] = process.argv;
const { rows } = JSON.parse(fs.readFileSync(scanFile, 'utf8'));
const HARD = new Set(['echo', 'misread', 'reader_voice', 'misattribution', 'unresponsive', 'post_on_greeting', 'invented_experience', 'ungrounded', 'unsolicited_advice', 'awkward', 'ignored_request', 'question_on_greeting', 'stock', 'chatbot', 'wrong_role', 'presumption']);
const OWNER_INFO = /메일|업데이트|다운로드|링크|보내 ?드렸|1\.0\.|버전|설치|고쳤|수정했|확인해 보니|죄송/;
const counts = {};
for (const row of rows) { const key = normalizeCommentText(row.replyText); counts[key] = (counts[key] || 0) + 1; }

const llm = new EmbeddedLlamaServer({ remoteUrl: url });
llm.status = 'running'; llm.acceleration = 'GPU';
llm.addLog = () => {};
const plan = []; const kept = []; const owner = [];
const recentByPost = {};
for (const row of rows.sort((a, b) => a.replyTime.localeCompare(b.replyTime))) {
  const type = classifyComment(row.parentText);
  if (OWNER_INFO.test(row.replyText) || type === 'question' || type === 'request') { owner.push({ ...row, why: OWNER_INFO.test(row.replyText) ? '직접 쓴 안내' : `${type === 'question' ? '질문' : '요청'} 댓글` }); continue; }
  const codes = checkReply(row.replyText, { commentText: row.parentText, postTitle: row.title, postSnippet: '' }).reasons.map((r) => r.code).filter((c) => HARD.has(c));
  const repeated = counts[normalizeCommentText(row.replyText)] >= 3;
  if (!codes.length && !repeated) { kept.push(row); continue; }
  const recent = [...(recentByPost[row.logNo] || []), ...plan.slice(-12).map((p) => p.newText)];
  let newText = '';
  try { newText = await llm.generateCommentReply({ postTitle: row.title, postSnippet: '', commentText: row.parentText, commenterName: row.parentAuthor, recentReplies: recent }); } catch (e) { newText = ''; }
  if (!newText) { kept.push({ ...row, note: '새 답글을 만들지 못함' }); continue; }
  (recentByPost[row.logNo] ||= []).push(newText);
  plan.push({ logNo: row.logNo, title: row.title, replyNo: row.replyNo, parentText: row.parentText, replyText: row.replyText, newText, why: [...codes, ...(repeated ? [`반복 ${counts[normalizeCommentText(row.replyText)]}회`] : [])].join(','), kind: llm.lastReplyKind });
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 1));
}
fs.writeFileSync(planFile.replace(/\.json$/, '.kept.json'), JSON.stringify({ kept, owner }, null, 1));
console.log('replies', rows.length, 'to fix', plan.length, 'kept', kept.length, 'owner', owner.length);
