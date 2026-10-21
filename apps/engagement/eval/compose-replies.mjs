// Composed replies (lib/reply-compose.js) for the 171 real comments in fixtures/reply-cases.json, in order, each
// blog remembering its recent replies like the app does. No model needed: read every line before shipping.
// usage: node eval/compose-replies.mjs [out.json]
import fs from 'node:fs';
import { classifyComment } from '../lib/comment-harness.js';
import { composeReply } from '../lib/reply-compose.js';

const here = new URL('.', import.meta.url);
const [, , outFile = new URL('reports/compose-latest.json', here)] = process.argv;
const cases = JSON.parse(fs.readFileSync(new URL('fixtures/reply-cases.json', here)));
const recent = {}; const out = [];
let seed = 7; const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
for (const c of cases) {
  const type = classifyComment(c.comment);
  if (type === 'question' || type === 'request') { out.push({ comment: c.comment, reply: '', type }); continue; }
  recent[c.blog] ||= [];
  const reply = composeReply(c.comment, { postTitle: c.title, postSnippet: c.post, recentReplies: recent[c.blog].slice(-12).reverse(), random });
  recent[c.blog].push(reply);
  out.push({ title: c.title.slice(0, 30), comment: c.comment, reply, type });
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
const replies = out.filter((o) => o.reply).map((o) => o.reply);
console.log('replies', replies.length, 'unique', new Set(replies).size, 'top repeats', JSON.stringify(Object.entries(replies.reduce((m, r) => ({ ...m, [r]: (m[r] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 3)));
