// Regenerates replies for the 171 real comments in fixtures/reply-cases.json with E2B, the way the app routes them.
// Judge the output blind with REPLY-JUDGE.md (good / minor / bad) and compare against the last run before saying a
// reply change is better. 2026-10-20 baselines: v6 (E2B on remarks) good 131 / minor 31 / bad 9; v12 (set replies on remarks) good 142 / minor 28 / bad 1.
// usage: node eval/reply-eval.mjs [out.json] [llama url]
import fs from 'node:fs';
import { classifyComment } from '../lib/comment-harness.js';
import { EmbeddedLlamaServer } from '../lib/embedded-llama.js';

const here = new URL('.', import.meta.url);
const [, , outFile = new URL('reports/replies-latest.json', here), remoteUrl = 'http://192.168.219.112:8081'] = process.argv;
const cases = JSON.parse(fs.readFileSync(new URL('fixtures/reply-cases.json', here)));
const llm = new EmbeddedLlamaServer({ remoteUrl });
llm.status = 'running'; llm.acceleration = 'GPU';
const rejects = []; llm.addLog = (t) => { if (/rejected/i.test(t)) rejects.push(t); };
const recent = {}; const out = [];
for (const c of cases) {
  const before = rejects.length; let reply, kind;
  const route = classifyComment(c.comment);
  if (route === 'question' || route === 'request') { out.push({ ...c, reply: '', kind: 'owner', rejects: [] }); continue; }
  recent[c.blog] ||= [];
  try { reply = await llm.generateCommentReply({ postTitle: c.title, postSnippet: c.post, commentText: c.comment, recentReplies: recent[c.blog].slice(-10) }); kind = llm.lastReplyKind; recent[c.blog].push(reply); }
  catch (e) { reply = ''; kind = 'skip: ' + e.message.slice(0, 90); }
  out.push({ ...c, reply, kind, rejects: rejects.slice(before).map((r) => (r.match(/\): ([^(]+)\(/) || [])[1]?.trim()) });
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
const n = (k) => out.filter((o) => o.kind.startsWith(k)).length;
console.log('total', out.length, 'ai', n('ai'), 'default', n('default'), 'owner', n('owner'), 'skip', n('skip'));
