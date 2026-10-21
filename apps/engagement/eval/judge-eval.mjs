// Can E2B review a comment before it goes up? Real neighbor posts (fixtures/feed-posts.json) with comments of known
// quality: good ones, and the failure kinds the 2026-10-21 audit found (an experience the commenter never had, the
// blogger taken for the person in the news, an ad told as one's own use, a comment about another post).
// Prints how many bad ones the judge stops and how many good ones it wrongly stops.
// usage: node eval/judge-eval.mjs [llama url]
import fs from 'node:fs';
import { judgeComment } from '../lib/comment-judge.js';

const here = new URL('.', import.meta.url);
const [, , url = 'http://192.168.219.112:8081'] = process.argv;
const posts = JSON.parse(fs.readFileSync(new URL('fixtures/feed-posts.json', here), 'utf8'));
const find = (part) => posts.find((post) => post.title.includes(part));
const cases = JSON.parse(fs.readFileSync(new URL('fixtures/judge-cases.json', here), 'utf8'));
const complete = async (messages) => {
  const res = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, temperature: 0, max_tokens: 120 }) });
  return (await res.json()).choices?.[0]?.message?.content || '';
};
let caught = 0; let bad = 0; let wrongly = 0; let good = 0;
for (const c of cases) {
  const post = find(c.post);
  if (!post) { console.log('no post', c.post); continue; }
  const verdict = await judgeComment({ title: post.title, contentSnippet: post.contentSnippet, comment: c.comment }, complete);
  if (c.label === 'bad') { bad += 1; if (!verdict.ok) caught += 1; } else { good += 1; if (!verdict.ok) wrongly += 1; }
  console.log(`${c.label === 'bad' ? (verdict.ok ? 'MISS ' : 'CATCH') : (verdict.ok ? 'PASS ' : 'WRONG')} [${c.kind || 'good'}] ${c.comment.slice(0, 50)} → ${verdict.reason}`);
}
console.log(`bad caught ${caught}/${bad}, good wrongly stopped ${wrongly}/${good}`);
