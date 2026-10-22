// 2026-10-21: the owner found canned, unrelated replies repeated under their posts ("예쁘게 봐 주셔서 감사해요" under
// "오늘도 좋은 정보 잘 배우고 갑니다", "좋은 말씀 남겨 주셔서 고마워요" 16 times). Replies now answer what was said.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeReply, josa, needsOwnAnswer, readComment, replyPlan } from '../lib/reply-compose.js';

const guide = { postTitle: '블로그 이웃 늘리기, 먼저 이웃 신청이 오는 블로그 만드는 법 (프로필·글 묶음·발행 주기)', postSnippet: '소개글에는 무엇을 누구를 위해 쓰는지 담습니다.' };
const poke = { postTitle: "[검단 포케 맛집] 검단 다양하고 맛있는 포케집 '슬로우캘리 검단신도시점'", postSnippet: '육회포케와 메밀면 포케를 먹었어요. 주차 1시간 지원.' };
const fixed = (seed = 3) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test('the reply answers what the visitor said, in their terms', () => {
  assert.doesNotMatch(composeReply('오늘도 좋은 정보 잘 배우고 갑니다 👍😊', { ...guide, random: fixed() }), /예쁘게|맛있/);
  assert.match(composeReply('오늘도 좋은 정보 잘 배우고 갑니다 👍😊', { ...guide, random: fixed() }), /도움|유익|활용|정보|쓸모|필요하실/);
  assert.match(composeReply('육회포케와 블랙페퍼치킨 포케 완전 맛있어 보여요!', { ...poke, random: fixed() }), /포케.*맛있|포케.*기억/);
  assert.match(composeReply('어느새 주말 마지막 날이네요 포스팅 잘 보고 갑니다!!', { ...poke, random: fixed() }), /주말/);
  assert.match(composeReply('알찬포스팅 잘 보고 갑니다! 추석인 오늘 행복한 날 보내세요', { ...guide, random: fixed() }), /추석/);
  assert.match(composeReply('좋은 정보가 담긴 포스팅 잘 보고갑니다 환절기 감기조심하세요~', { ...guide, random: fixed() }), /감기|건강/);
  assert.match(composeReply('정성스런 포스팅 잘 보고 갑니다^^ 제 블로그도 답방 와주세요~', { ...guide, random: fixed() }), /들를|놀러 갈|찾아갈/);
  assert.match(composeReply('유용한 정보 감사합니다 :) 답방 다녀갑니다!', { ...guide, random: fixed() }), /와 주셔서/);
  assert.match(composeReply('슬로우캘리 자주갔는데 금액적인 부분이 아쉽지만 먹을만 했어요', { ...poke, random: fixed() }), /솔직|아쉬/);
  assert.match(composeReply('위치 바로 지도에 저장해뒀어요 메뉴 고르기 힘들 때 여기로 가야겠어요', { ...poke, random: fixed() }), /가 보세요|들러 보세요|후회/);
  assert.doesNotMatch(composeReply('위치 바로 지도에 저장해뒀어요 메뉴 고르기 힘들 때 여기로 가야겠어요', { ...poke, random: fixed() }), /쉽지 않/);
});

test('no misreads: post words are not the greeting, a plan is not a request', () => {
  assert.equal(readComment('이웃 신청보다 먼저 프로필부터 챙겨야겠네요!', guide).neighborAdd, false);
  assert.equal(readComment('좋은 글 잘 읽고 이웃 신청 살짝 남겨두고 가요', guide).neighborAdd, true);
  assert.equal(readComment('아이 첫 캠핑을 준비·예약·비 오는 날 대처로 나눈 예시가 구체적이네요', guide).rain, false);
  assert.equal(readComment('늦어도 답방 꼭 갑니다 ~', guide).visitAsk, false);
  assert.equal(readComment('좋은정보 잘보고 갑니다 힘찬월요일 되세요', guide).cheer, false);
  assert.doesNotMatch(composeReply('요즘 철이라 손질방법 궁금했는데, 잘보고갑니다', { postTitle: '꽃게 손질 방법', postSnippet: '꽃게 손질', random: fixed() }), /부분/);
});

test('replies vary: a line just used is not used again', () => {
  const recent = [];
  for (let i = 0; i < 8; i += 1) {
    const reply = composeReply('좋은 정보 감사합니다!', { ...guide, recentReplies: [...recent].reverse(), random: fixed(i + 1) });
    assert.ok(!recent.slice(-3).includes(reply), reply);
    recent.push(reply);
  }
});

// 2026-10-22: E2B's own replies to opinions were wrong 18 times in 42 (made-up experiences, a reader's voice). Only a
// request is left to the owner; an opinion, a story or a tip gets a reply that answers its kind.
test('only a request is left to the owner; an opinion, a story or a tip is answered for its kind', () => {
  assert.equal(needsOwnAnswer('카멜클라우드 pc용 배포 요청드립니다.'), true);
  assert.equal(needsOwnAnswer('서이추 중요하죵하지만 이웃추가 후 서로 교류하지 않으면 의미가 없더라고요~행복 하루요~'), false);
  assert.deepEqual(replyPlan('서이추 중요하죵하지만 이웃추가 후 서로 교류하지 않으면 의미가 없더라고요~행복 하루요~', { ...guide, random: () => 0 }), ['story', 'wish']);
  assert.deepEqual(replyPlan('오 뚫어뻥 없을 때 변기 막히면 난감한데ㅎㅎ 샴푸 한번 사용해보면 좋을 것 같아요!', { postTitle: '꽉 막힌 변기 뚫는 법', random: () => 0 }), ['tip', 'wish']);
  assert.deepEqual(replyPlan('반복해서 받는 질문을 다음 글의 소재로 이어 간다는 부분이 눈에 들어오네요.', { ...guide, random: () => 0 }), ['point', 'wish']);
  // Greetings with "저도" are not stories.
  assert.deepEqual(replyPlan('저도 잘 보고 가요~ 좋은 하루 보내세요', { ...guide, random: () => 0 }), ['thanks', 'wish']);
  assert.equal(josa('포케', '은/는'), '포케는');
  assert.equal(josa('육회', '이/가'), '육회가');
  assert.equal(josa('메밀면', '은/는'), '메밀면은');
});

// 2026-10-21 second audit of the owner's blog: what the composed replies still missed.
test('praise of the writing, of a program I made, and encouragement to me each get their own answer', () => {
  const r = () => 0;
  const writing = composeReply('글을 참 차분하고 편안하게 쓰셔서 읽는 내내 마음이 편안해지네요. 소중한 이웃님 행복한 하루 보내세요 ~^^', { postTitle: '블로그 이웃 늘리기', random: r });
  assert.match(writing, /읽으셨다니|읽어 주셔서|읽혔다니/);
  const program = composeReply('이웃메이트라는 프로그램이 정말 유용해 보이네요. 비활성 이웃을 관리해 주는 점이 매력적이에요.', { postTitle: '이웃 관리 자동화 이웃메이트', random: r });
  assert.match(program, /만든|다듬어/);
  const encourage = composeReply('하루 30분 루틴을 잡는 것이 현명할 것 같아요. 꾸준히 시도해보시면 분명 좋은 변화가 생길 거예요.', { postTitle: '댓글 루틴', random: r });
  assert.match(encourage, /해 볼게요|이어 갈게요/);
  assert.doesNotMatch(encourage, /해 보시면|해 보세요/);
});

test('"자주 들릴께요" is a promise to visit', () => {
  assert.equal(readComment('잘 보았습니다. 자주 들릴께요..!').willVisit, true);
  assert.match(composeReply('잘 보았습니다. 자주 들릴께요..!', { random: () => 0 }), /자주|놀러|소통/);
});
