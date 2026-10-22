// 2026-10-21: two audits in one day each found replies the last fix had not seen ("자주 올려주세요" answered as a
// visit, "상황별로" read as a complaint, "씹어먹는" in a title making a PDF post a food post). Every real comment on
// the owner's blog is kept here with what the reply should answer; a change to reply-compose.js must pass all of them,
// and each audit adds the comments it finds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { composeReply, needsOwnAnswer, replyPlan } from '../lib/reply-compose.js';
import { checkReply, classifyComment } from '../lib/comment-harness.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/blog-comments.json', import.meta.url), 'utf8'));
// Spread small seeds over the range first: seed * 16807 alone starts every run near 0 and always picks a pool's first line.
const seeded = (seed) => { let state = (seed * 2654435761) % 2147483647; return () => { state = (state * 16807) % 2147483647; return state / 2147483647; }; };

test('every real comment on my blog gets the reply it should', () => {
  const wrong = [];
  for (const { post, comment, want } of cases) {
    const context = { postTitle: post };
    // As lib/embedded-llama.js routes it: questions and comments with a point of their own go to the model.
    const own = classifyComment(comment) === 'question' || needsOwnAnswer(comment, context);
    if (want === 'own' || own) {
      if ((want === 'own') !== own) wrong.push(`${comment.slice(0, 50)}\n   want ${want === 'own' ? 'own answer' : want.join('+')}, got ${own ? 'own answer' : replyPlan(comment, context).join('+')}`);
      continue;
    }
    const plan = replyPlan(comment, { ...context, random: () => 0 });
    const ok = plan.length === want.length && want.every((allowed, i) => allowed.split('|').includes(plan[i]));
    if (!ok) wrong.push(`${comment.slice(0, 50)}\n   want ${want.join('+')}, got ${plan.join('+')}`);
  }
  assert.deepEqual(wrong, [], `${wrong.length} of ${cases.length} real comments misread:\n${wrong.join('\n')}`);
});

test('composed replies to real comments pass the reply checks', () => {
  const failed = [];
  for (const { post, comment, want } of cases) {
    if (want === 'own' || classifyComment(comment) === 'question') continue;
    // Enough seeds that every line of a pool comes up (a 3-seed run missed "알려 주셔서", a reader's phrase, 2026-10-22).
    for (let seed = 1; seed <= 40; seed++) {
      const text = composeReply(comment, { postTitle: post, random: seeded(seed) });
      const result = checkReply(text, { commentText: comment, postTitle: post }, []);
      const reasons = (result.reasons || []).map((item) => item.code).filter((code) => code !== 'unresponsive');
      if (reasons.length) failed.push(`${comment.slice(0, 40)} → ${text} (${reasons.join(', ')})`);
    }
  }
  assert.deepEqual(failed, [], failed.join('\n'));
});
