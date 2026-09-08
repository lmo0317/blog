import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMENT_PROMPT_VERSION, buildBlogCommentMessages, validateBlogComment } from '../lib/comment-prompt.js';

test('comment prompt is versioned and uses stable structured fields', () => {
  const messages = buildBlogCommentMessages({ title: '성수 소금빵', contentSnippet: '오전 대기 20분', imageSummary: '소금빵 단면', recentComments: ['맛있어 보여요'] });
  assert.equal(COMMENT_PROMPT_VERSION, 'comment-system-v1');
  assert.equal(messages.length, 2);
  assert.match(messages[1].content, /\[제목\]\n성수 소금빵/);
  assert.match(messages[1].content, /\[최근 사용 댓글\]/);
});

test('comment validator rejects unsupported personal experience', () => {
  const result = validateBlogComment('저도 직접 가봤는데 성수 소금빵이 정말 맛있었어요.', { title: '성수 소금빵', contentSnippet: '작성자가 소금빵을 소개했다.' });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('unsupported_experience'));
});

test('comment validator treats exact SKIP as a valid abstention', () => {
  assert.deepEqual(validateBlogComment('SKIP').action, 'skip');
  assert.equal(validateBlogComment('SKIP').ok, true);
});
