// Quick reply check on a spread of the real comments (every Nth of fixtures/reply-cases.json), keeping every
// rejected attempt's text, so a prompt or check change can be read before the full reply-eval.mjs run.
// usage: node eval/reply-sample.mjs <out.json> [llama url] [count]
import fs from 'node:fs';
import { classifyComment } from '../lib/comment-harness.js';
import { EmbeddedLlamaServer } from '../lib/embedded-llama.js';

const here = new URL('.', import.meta.url);
const [, , outFile, remoteUrl = 'http://192.168.219.112:8081', count = '30'] = process.argv;
const all = JSON.parse(fs.readFileSync(new URL('fixtures/reply-cases.json', here))).filter((c) => !['question', 'request'].includes(classifyComment(c.comment)));
const step = Math.max(1, Math.floor(all.length / Number(count)));
const cases = all.filter((_, i) => i % step === 0).slice(0, Number(count));
const llm = new EmbeddedLlamaServer({ remoteUrl });
llm.status = 'running'; llm.acceleration = 'GPU';
let tries = []; llm.addLog = (text) => { if (/rejected/i.test(text)) tries.push(text.replace(/^Reply rejected /, '')); };
const recent = {}; const out = [];
for (const c of cases) {
  tries = [];
  recent[c.blog] ||= [];
  let reply = '';
  try { reply = await llm.generateCommentReply({ postTitle: c.title, postSnippet: c.post, commentText: c.comment, recentReplies: recent[c.blog].slice(-10) }); recent[c.blog].push(reply); }
  catch (e) { reply = ''; }
  out.push({ title: c.title.slice(0, 40), comment: c.comment, reply, tries });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
}
console.log('cases', out.length, 'replied', out.filter((o) => o.reply).length);
