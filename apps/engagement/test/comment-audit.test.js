// Cases from the 2026-10-19 audit of every comment and reply the autopilot posted (974 comments, 124 replies,
// 67 customer comments). Each one was posted for real; none may pass again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCommentText, sensitivePostReason, validateBlogComment } from '../lib/comment-prompt.js';
import { checkReply } from '../lib/comment-harness.js';
import { cleanFeedAuthor } from '../lib/naver-feed-engage.js';
import { isDeliberateCommentSkip } from '../lib/comment-style.js';

test('no AI comment on deaths, crimes and trials, accidents, illness or clinic procedure ads', () => {
  for (const title of ['징역 17년 확정 JMS 정명석, 여신도 성범죄', '🕊️🎭 연극계 거장 별세… ‘고도를 기다리며’', '지방분해주사 4일 후기', '암 투병 3년차 일상', '교통사고로 숨진 20대']) {
    assert.match(sensitivePostReason({ title }), /민감한 주제/, title);
  }
  for (const title of ['오사카 맛집 리스트 총정리', '이제 과속카메라도 하늘에 달아야 하나?', '피부과에서 받은 여드름 관리', '26개월 아기와 에버랜드 할로윈']) {
    assert.equal(sensitivePostReason({ title }), '', title);
  }
  assert.equal(isDeliberateCommentSkip(sensitivePostReason({ title: '배우 별세' })), true);
});

test('a comment may not invent a life the commenter does not have', () => {
  const ctx = { title: '삿포로 항공권 비교', contentSnippet: '겨울 삿포로 여행 준비할 때 트립닷컴에서 항공권 가격 비교' };
  for (const text of [
    '겨울 삿포로 여행 준비할 때 항공권 가격 비교가 정말 중요하더라고요. 저도 트립닷컴에서 좋은 딜을 찾았어요.',
    '저희 아이도 삿포로 눈축제를 좋아해서 항공권 비교 글이 반갑네요.',
    '삿포로 항공권 정리 덕분에 학부모 입장에서 겨울방학 계획 세우기가 수월하겠어요.',
    '트립닷컴 비교 글을 보니 도쿄에서 번역기 쓰던 기억이 저도 생생해요.'
  ]) assert.ok(validateBlogComment(text, ctx).reasons.includes('unsupported_experience'), text);
  // The post's own words are not an invented life.
  const family = { title: '26개월 아기와 에버랜드 할로윈', contentSnippet: '아이와 함께 즐길 프로그램이 많았어요' };
  assert.equal(validateBlogComment('에버랜드 할로윈에 아이와 함께 즐길 프로그램이 이렇게 많다니 26개월 아기도 신났겠어요.', family).reasons.includes('unsupported_experience'), false);
});

test('in a news write-up the blogger is not the person in the news', () => {
  const ctx = { title: '“암 진행 가능성” 10kg 감량했던 개그우먼 갑상선 수술', contentSnippet: '소속사 관계자는 수술이 잘 끝났다고 전했다.' };
  assert.ok(validateBlogComment('갑상선 수술까지 받으시면서도 솔직하게 근황을 나눠주셔서 감사해요.', ctx).reasons.includes('news_as_person'));
  assert.equal(validateBlogComment('갑상선 수술이 잘 끝났다는 소속사 소식에 안도가 되네요. 회복 기간을 충분히 가지셨으면 해요.', ctx).reasons.includes('news_as_person'), false);
});

test('quotes inside a comment survive cleanup; math markup is an artifact', () => {
  assert.equal(normalizeCommentText("'학교 2013'이라는 드라마 이야기가 반갑네요"), "'학교 2013'이라는 드라마 이야기가 반갑네요");
  assert.equal(normalizeCommentText('"사진이 예쁘네요"'), '사진이 예쁘네요');
  assert.ok(validateBlogComment('인공 뉴런에 $x_1$ 입력값과 가중치가 연결되는 방식이 흥미롭네요.', { title: '인공지능수학 인공 뉴런' }).reasons.includes('artifact'));
});

test('replies answer what the visitor said', () => {
  // "잘 보고갑니다" read as 들고 가다
  const misread = checkReply('들고 가신다니 좋네요. 좋은 하루 보내세요!', { commentText: '잘 보고갑니다 👍', postTitle: '블로그 서로이웃 늘리는 법' });
  assert.ok(misread.reasons.some((r) => r.code === 'misattribution'));
  // a greeting asking for a visit, answered with a made-up story
  const visit = '안녕하세요 인사드려요~~^^ 정성스러운 포스팅 잘 보고갑니다 시간 나실때 제 블로그에도 방문해주시면 참으로 감사하겠습니다';
  const story = checkReply('저도 이런 경험 많이 해서 공감되네요. 두꺼운 자료 앞에 앉으면 정말 시간 가는 줄 모르잖아요.', { commentText: visit, postTitle: '50페이지 보고서' });
  assert.deepEqual(['ignored_request', 'invented_experience'].every((code) => story.reasons.some((r) => r.code === code)), true);
  assert.equal(checkReply('찾아와 주셔서 고마워요. 시간 날 때 꼭 들를게요, 평안한 하루 보내세요!', { commentText: visit, postTitle: '50페이지 보고서' }).ok, true);
});

test('the feed section label is not part of the blogger name', () => {
  assert.equal(cleanFeedAuthor('당신을 위한 추천글 히진', 'hijin'), '히진');
  assert.equal(cleanFeedAuthor('내 이웃의 인기글 긍정이', 'x'), '긍정이');
  assert.equal(cleanFeedAuthor('최근 방문한 블로그의 다른 글 라또', 'x'), '라또');
  assert.equal(cleanFeedAuthor('골든리프', 'x'), '골든리프');
  assert.equal(cleanFeedAuthor('', 'bid'), 'bid');
});

test('a reply does not repeat the visitor’s own words back (E2B habit)', () => {
  const post = { postTitle: '블로그 서로이웃 늘리는 법', postSnippet: '하루 한도 안에서 천천히 늘리기' };
  for (const [commentText, reply] of [
    ['오호 신기하네요ㅎㅎ', '오호 신기하네요ㅎㅎ'],
    ['오 이웃 늘리는 방법 잘 보구 갑니다!!완전 도움됬어요~ 오늘도 좋은하루 보내세요!', '완전 도움됐어요~ 오늘도 좋은하루 보내세요!'],
    ['내용대로 꼭 활용해봐야겠습니다~좋은 정보 포스팅 잘 읽고 갑니다^^', '내용대로 꼭 활용해봐야겠습니다~']
  ]) assert.ok(checkReply(reply, { ...post, commentText }).reasons.some((r) => r.code === 'echo'), reply);
  // Taking up their words in my own thank-you is fine.
  const ok = checkReply('이웃 늘리는 방법 잘 보고 가신다니 글 쓴 보람이 있네요. 오늘 기분 좋은 일 가득하세요.', { ...post, commentText: '오 이웃 늘리는 방법 잘 보구 갑니다!!완전 도움됬어요~ 오늘도 좋은하루 보내세요!' });
  assert.equal(ok.reasons.some((r) => r.code === 'echo'), false);
});

test('a reply is the author speaking, and "다녀갑니다" is a goodbye, not a trip', () => {
  const post = { postTitle: '뚫어뻥 없을 때 변기 뚫는 법', postSnippet: '샴푸와 온수로 10분' };
  assert.ok(checkReply('변기 뚫는 방법이 생겨서 기억해 두려고요.', { ...post, commentText: '오~변기뚧기!이런 방법이 있었네요기억해둬야겠어요' }).reasons.some((r) => r.code === 'reader_voice'));
  assert.ok(checkReply('변기 막힐 때 정말 난감하죠. 샴푸 사용법이라도 한번 시도해 봐야겠네요.', { ...post, commentText: '오 뚫어뻥 없을 때 변기 막히면 난감한데ㅎㅎ' }).reasons.some((r) => r.code === 'reader_voice'));
  assert.ok(checkReply('여행 즐겁게 다녀오세요 😊', { ...post, commentText: '잘 보고 다녀갑니다😊' }).reasons.some((r) => r.code === 'misread'));
  assert.ok(checkReply('답방 잘 다녀오세요.', { ...post, commentText: '유용한 정보 감사합니다 :) 답방 다녀갑니다!' }).reasons.some((r) => r.code === 'misread'));
});
