// 2026-10-21: the owner found canned, unrelated replies repeated under their posts ("예쁘게 봐 주셔서 감사해요" under
// "오늘도 좋은 정보 잘 배우고 갑니다", "좋은 말씀 남겨 주셔서 고마워요" 16 times). Replies now answer what was said.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeReply, josa, needsOwnAnswer, readComment } from '../lib/reply-compose.js';

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

test('an opinion of their own goes to the model first; greetings and praise do not', () => {
  assert.equal(needsOwnAnswer('서이추 중요하죵하지만 이웃추가 후 서로 교류하지 않으면 의미가 없더라고요~행복 하루요~', guide), true);
  assert.equal(needsOwnAnswer('잘 보고 갑니다! 좋은 하루 보내세요 :)', guide), false);
  assert.equal(needsOwnAnswer('육회 메밀면 포케 넘 맛있어보여요', poke), false);
  assert.equal(josa('포케', '은/는'), '포케는');
  assert.equal(josa('육회', '이/가'), '육회가');
  assert.equal(josa('메밀면', '은/는'), '메밀면은');
});
