// Regenerates feed comments for real neighbor posts (fixtures/feed-posts.json: title, body, image note and the comment
// that was posted) with the current prompt and checks, so a change is judged on the posts it will really meet.
// Read the output side by side with oldComment; count commentary voice, misreads and repeats before shipping.
// usage: node eval/feed-eval.mjs [out.json] [llama url] [posts json]
import fs from 'node:fs';
import { EmbeddedLlamaServer } from '../lib/embedded-llama.js';

const here = new URL('.', import.meta.url);
const [, , outFile = new URL('reports/feed-latest.json', here), remoteUrl = 'http://192.168.219.112:8081', postsFile = new URL('fixtures/feed-posts.json', here)] = process.argv;
const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8')).filter((post) => !post.error);
const llm = new EmbeddedLlamaServer({ remoteUrl });
llm.status = 'running'; llm.acceleration = 'GPU';
const rejects = []; llm.addLog = (text) => { if (/rejected/i.test(text)) rejects.push(text); };
const recent = []; const out = [];
for (const post of posts) {
  const before = rejects.length;
  llm.lastCommentFailure = '';
  const comment = await llm.generateBlogComment({ title: post.title, contentSnippet: post.contentSnippet, imageSummary: post.imageSummary, recentComments: recent.slice(0, 30) }).catch((error) => '');
  if (comment) recent.unshift(comment);
  out.push({ title: post.title, oldComment: post.oldComment, comment, skipped: comment ? '' : (llm.lastCommentFailure || 'skip'), rejects: rejects.slice(before).length });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
}
const written = out.filter((row) => row.comment);
const COMMENTARY = /인상적|인상 깊|흥미롭|소식을 (?:접|보니|들으니)|생각해 ?보게|생각하게 (?:되|됩)|중요할 것 같/;
console.log('posts', out.length, 'written', written.length, 'skipped', out.length - written.length,
  'commentary old', out.filter((row) => COMMENTARY.test(row.oldComment)).length, 'new', written.filter((row) => COMMENTARY.test(row.comment)).length);
