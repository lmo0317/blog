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

test('comment validator rejects fabricated reader circumstances', () => {
  const result = validateBlogComment('저도 충무로에서 갈 카페를 찾고 있었는데 섹터커피 위치가 괜찮네요.', {
    title: '충무로 섹터커피',
    contentSnippet: '충무로역 3번 출구 인근에 있으며 크림 라떼를 판매한다.'
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('unsupported_reader_context'));
});

test('comment validator rejects implied first-person context without a pronoun', () => {
  const context = { title: '여름 바디스프레이', contentSnippet: '가벼운 향의 바디스프레이 사용법을 소개했다.' };
  for (const comment of [
    '여름에 쓸 향을 찾고 있었는데 가벼운 바디스프레이가 괜찮아 보이네요.',
    '향수보다 가벼운 바디스프레이가 훨씬 좋더라고요. 사용법도 유용하네요.'
  ]) {
    const result = validateBlogComment(comment, context);
    assert.ok(result.reasons.includes('unsupported_reader_context'));
  }
});

test('comment validator rejects unsupported hearsay', () => {
  const result = validateBlogComment('섹터커피 크림 라떼가 유명하다고 들었는데 한번 마셔보고 싶네요.', {
    title: '충무로 섹터커피', contentSnippet: '충무로역 인근에서 크림 라떼를 판매한다.'
  });
  assert.ok(result.reasons.includes('unsupported_hearsay'));
});

test('comment validator treats exact SKIP as a valid abstention', () => {
  assert.deepEqual(validateBlogComment('SKIP').action, 'skip');
  assert.equal(validateBlogComment('SKIP').ok, true);
});
