// Cases from the 2026-10-19 audit of every comment and reply the autopilot posted (974 comments, 124 replies,
// 67 customer comments). Each one was posted for real; none may pass again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCommentText, sensitivePostReason, validateBlogComment } from '../lib/comment-prompt.js';
import { checkComment, checkReply, classifyComment, SOFT_CODES } from '../lib/comment-harness.js';
import { cleanFeedAuthor, isNeighborFeedPost } from '../lib/naver-feed-engage.js';
import { DEFAULT_COMMENTS, DEFAULT_REPLIES, isDeliberateCommentSkip } from '../lib/comment-style.js';

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

test('found on the deployed E2B: restating the visitor and "보고 가세요"', () => {
  const post = { postTitle: '블로그 서로이웃 늘리는 법', postSnippet: '하루 한도 안에서 천천히' };
  assert.ok(checkReply('오호, 신기하다고 하셨네요.', { ...post, commentText: '오호 신기하네요ㅎㅎ' }).reasons.some((r) => r.code === 'echo'));
  assert.ok(checkReply('오호 신기하네요ㅎㅎ 꾸준함이 중요하다고 생각해요.', { ...post, commentText: '오호 신기하네요ㅎㅎ' }).reasons.some((r) => r.code === 'echo'));
  assert.ok(checkReply('네, 이웃님도 잘 보고 가세요. 😊', { ...post, commentText: '잘 보고 다녀갑니다😊' }).reasons.some((r) => r.code === 'misread'));
  assert.match(sensitivePostReason({ title: '“암 진행 가능성” 10kg 감량했던 개그우먼 갑상선 4분의 3 절제 후 전한 속사정' }), /투병/);
});

test('no set comment when the AI says SKIP or fails: a like only (2026-10-21, canned lines under news posts)', async () => {
  const { EmbeddedLlamaServer } = await import('../lib/embedded-llama.js');
  const llama = new EmbeddedLlamaServer({ modelManager: null });
  llama.chatCompletion = async () => 'SKIP';
  assert.equal(await llama.generateBlogComment({ title: '사진 몇 장', contentSnippet: '' }), '');
  assert.match(llama.lastCommentFailure, /공감만 했습니다/);
  assert.equal(await llama.generateBlogComment({ title: '배우 OOO 별세… 향년 78세', contentSnippet: '' }), '');
  llama.chatCompletion = async () => { throw new Error('timeout'); };
  assert.equal(await llama.generateBlogComment({ title: '오사카 맛집', contentSnippet: '규카츠' }), '');
});
test('a reply that reuses one of the visitor sentences is an echo', () => {
  const r = checkReply('답방 왔어요! 저도 자주 놀러 갈게요.', { postTitle: '블로그 서로이웃 늘리는 법', commentText: '답방 왔어요! 제 블로그도 놀러 와 주세요' });
  assert.ok(r.reasons.some((x) => x.code === 'echo'));
});

test('a visit request is answered by the autopilot; a request for the program goes to the owner', async () => {
  const { classifyComment } = await import('../lib/comment-harness.js');
  assert.equal(classifyComment('답방 왔어요! 제 블로그도 놀러 와 주세요'), 'greeting');
  assert.equal(classifyComment('시간 나실때 제 블로그에도 방문해주시면 감사하겠습니다'), 'greeting');
  assert.equal(classifyComment('Storm1399@naver.com 카멜클라우드 pc용 배포 요청드립니다.'), 'request');
  assert.equal(classifyComment('프로그램 공유받고 싶어요. 메일로 보내 주세요'), 'request');
  assert.equal(classifyComment('이거 맥에서도 되나요?'), 'question');
});

// 2026-10-20 audit: a customer's 48 replies on their own review post (25 read as a parrot, a reader, or the shop),
// and 40 comments/replies from the newest code on E2B.
test('the review author has already been there, and is not the shop', () => {
  const post = { postTitle: '검단신도시 포케 맛집 슬로우캘리 육회포케 후기', postSnippet: '육회포케와 메밀면을 먹어 봤어요. 양이 많고 매장도 쾌적했어요.' };
  const bad = [
    ['육회 메밀면 포케 넘 맛있어보여요🥹', '육회 메밀면 포케가 맛있어 보인다고 하니 저도 기대되네요.', 'reader_voice'],
    ['육회포케라는것도 있네요 ㄷㄷ든든하고 맛있어보여요~~', '육회포케가 있다는 점이 흥미롭네요. 저도 그 메뉴 한번 먹어보고 싶어요.', 'reader_voice'],
    ['위치 바로 지도에 켜서 저장해뒀어요', '저희 가게 위치를 지도에 저장해두시면 찾기 편하실 거예요.', 'wrong_role'],
    ['양이 한가득이에요 ㅋㅋㅋㅋ진짜 맛있겠어요!!', '푸짐하게 담아 드렸는데 맛있게 드셨다니 다행이네요.', 'wrong_role'],
    ['포케 좋아하시면 혼밥하러 자주 찾게 될 것 같아요', '혼밥하러 자주 찾으실 수 있도록 쾌적한 공간을 유지하려고 노력하고 있습니다.', 'wrong_role'],
    ['양이 한가득이에요 ㅋㅋㅋㅋ진짜 맛있겠어요!!', '양이 한가득이라고 하니 더 맛있어 보이네요.', 'reader_voice'],
    ['육회포케라는것도 있네요 ㄷㄷ든든하고 맛있어보여요~~', '육회포케가 든든하고 맛있어 보인다고 하니 다행이네요.', 'echo'],
    ['좋은정보 잘보고 갑니다~^^', '정보 잘 보시고 방문해 주셔서요.', 'awkward'],
    ['건강하고 맛있겠어요💕', '푸짐하고 맛있다니 정말 만족스러우셨다니 다행입니다.', 'awkward']
  ];
  for (const [comment, reply, code] of bad) {
    assert.ok(checkReply(reply, { commentText: comment, ...post }).reasons.some((item) => item.code === code), `${code}: ${reply}`);
  }
  // A shop owner's own post may say 저희 가게.
  assert.ok(!checkReply('저희 가게 위치는 역에서 5분 거리라 찾기 쉬워요.', { commentText: '위치가 어디예요?', postTitle: '저희 가게 오픈했어요', postSnippet: '드디어 저희 가게를 오픈했습니다.' }).reasons.some((item) => item.code === 'wrong_role'));
  // Speaking from experience passes.
  assert.deepEqual(checkReply('그 조합으로 입맛이 확 살아나더라고요.', { commentText: '육회에 메밀면, 매콤깻잎소이소스 조합이라니 입맛 확 살아날 것 같네요👍', ...post }).reasons.filter((item) => !SOFT_CODES.has(item.code)), []);
});

test('a remark about 답방 is not a visit request; a controversy gets no smiley; defaults assume nothing', () => {
  assert.equal(classifyComment('‘잘 보고 갑니다’를 줄이고 읽은 티가 나는 댓글로 바꾼 뒤 답방 흐름이 생겼다는 대목이 흥미롭네요.'), 'remark');
  assert.equal(classifyComment('답방요~'), 'greeting');
  assert.ok(validateBlogComment('판매자 측이 과하게 대응했다고 해명한 점이 눈에 띄네요. 😊', { title: "게장 원산지 질문했더니 '채팅 차단'?…논란에 해명" }).reasons.includes('tone'));
  for (const line of [...DEFAULT_COMMENTS, ...DEFAULT_REPLIES.remark]) assert.doesNotMatch(line, /새 글|오늘도 들러|자주 들르|오늘 글도|들러 주세요|좋게 봐/, line);
});

// 2026-10-20 reply eval (171 real comments, E2B, judged blind): what the set replies and routing must keep doing.
test('greetings, visit asks and one-line compliments get a set reply; chatty "??" is not a question', async () => {
  const { pickDefaultReply, commentTopic } = await import('../lib/comment-style.js');
  const title = "[검단 포케 맛집] 검단 다양하고 맛있는 포케집 '슬로우캘리 검단신도시점'";
  assert.equal(commentTopic('육회포케라는것도 있네요 ㄷㄷ든든하고 맛있어보여요~~', title), '포케');
  assert.equal(commentTopic('너무 맛있을 것 같아요!', title), '');
  assert.match(pickDefaultReply('remark', '포케 양 푸짐하고 넘 맛나보여용', [], { postTitle: title }), /^포케 /);
  assert.match(pickDefaultReply('remark', '슬로우캘리 자주갔는데 금액적인 부분이 아쉽지만 먹을만 했어요', [], { postTitle: title }), /솔직/);
  assert.doesNotMatch(pickDefaultReply('remark', '샴푸 한번 사용해보면 좋을 것 같아요!', [], { postTitle: '뚫어뻥 없을 때 변기 뚫는 법' }), /마음에 들어|좋게 봐/);
  assert.equal(classifyComment('답방 와주실거죠?💚'), 'greeting');
  assert.equal(classifyComment('독서??말고 블로그쓰는 우리!!이번주도 화이팅해요!!'), 'greeting');
  assert.equal(classifyComment('앞으로도 자주 올려주세요!'), 'greeting');
  assert.equal(classifyComment('글 잘 보고 갑니다 공감하는 곳이 없네요'), 'request');
  assert.equal(classifyComment('이거 무료예요?'), 'question');
});

test('E2B habits on replies found by the eval are rejected', () => {
  const c = '구미에서 식당 준비하면서 이것저것 찾아보다가 들어왔는데, 유익한 글에 도움 많이 받고 갑니다.';
  const post = { postTitle: '프로젝트 회고', postSnippet: '이번 프로젝트 준비 과정' };
  const codes = (reply, commentText = c) => checkReply(reply, { commentText, ...post }).reasons.map((item) => item.code);
  assert.ok(codes('프로젝트 준비하시느라 고생 많으셨네요.').includes('misattribution'));
  assert.ok(codes('정리가 도움이 되었다니 다 기쁘네요.').includes('awkward'));
  assert.ok(codes('깔끔하다니 다행이네요.', '너무 깔끔하네요!').includes('echo'));
  assert.ok(codes('어떤 메뉴를 좋아하시는지 알려주시면 추천해 드릴게요.', '메뉴 고르기 힘들 때 가야겠어요').includes('chatbot'));
  assert.ok(codes('저도 다음에 방문할 생각이에요.', '사진도 깔끔하고 분위기까지 잘 보여서 좋았어요').includes('reader_voice'));
  assert.ok(codes('저도 다이어트 때문에 포케 자주 찾게 되거든요.', '다이어트 중이라 저도 포케 자주찾게 되던데').includes('echo'));
});

test('E2B replies the eval v7-v10 still let through are rejected', () => {
  const bad = (reply, commentText) => !checkReply(reply, { commentText, postTitle: '테스트 글' }).ok;
  assert.ok(bad('육회포케가 맛있어 보인다고 하니 저도 기분이 좋네요.', '와 육회포케에 육회가 가득들어있어서 너무 맛있어보이네요'));
  assert.ok(bad('비주얼 좋다고 해주시니 저도 기분이 좋네요.', '비주얼 너무 좋네요 ㅎㅎ 맛있어보여요'));
  assert.ok(bad('꿀 정보라고 말씀해주셔서 다행입니다.', '블로그운영하는사람한테 꿀 정보네요!!'));
  assert.ok(bad('샴푸 사용해 보라는 의견 주셔서 저도 그 방법으로 시도해 봤어요.', '샴푸 한번 사용해보면 좋을 것 같아요!'));
  assert.ok(bad('답방 원하신다고 하니 꼭 들를게요.', '답방이라는 의미에 대해 다시 생각해보는 글이네요, 인간미 넘치는 답글 해보도록 할께요 !'));
  assert.ok(bad('육회 들어가는 포케 맛에 대해 궁금하시군요.', '저 사실 포케 한번도 안 먹어봤는데 육회 들어가면 넘 맛나겠어요!!'));
  assert.ok(bad('우미카 중고차 한번 찾아봤어요.', '오늘도 같이 힘내봐요 ^^우미카 중고차 정대표 입니다'));
  assert.ok(bad('손물림은 하지 않게 조심해서 다뤄야 해요.', '꽃게를 샀으면 손물림은 없었을텐데...싶은 생각이ㅎㅎ'));
  assert.ok(bad('읽어 주셔서 감사해요. 답방 꼭 가보세요.', '포스팅 잘 보고 갑니다 !늦어도 답방 꼭 갑니다 ~'));
  assert.ok(bad('정보 잘 보고 가줘서 고맙다.', '좋은 정보 감사합니다포스팅 잘보고가요!'));
  assert.ok(bad('다이어트 중이라 자주 찾는구나. 건강하게 즐기길 바라요.', '다이어트 중이라 저도 포케 자주찾게 되던데'));
  assert.ok(bad('프로그램 만드신 것에 대해 좋게 봐 주셔서 감사합니다.', '프로그램을 만드셨다니 대단하네요'));
  assert.ok(bad('환절기 감기 조심하라는 말씀 잘 들었습니다.', '환절기 감기조심하세요~'));
  // Still fine: a thank-you in my own words, and a visit request answered with a visit.
  assert.ok(!bad('늘 열심이라고 응원해 주셔서 고맙습니다. 덕분에 힘이 나네요.', '포스팅 잘 보고 갑니다.늘 열심! 당신을 응원합니다~~~'));
  assert.ok(!bad('답방 와 주셔서 고마워요. 저도 꼭 들를게요.', '답방 왔어요~ 저희 블로그도 놀러 와 주세요'));
});

test('remarks get set replies that fit what was said (eval v12)', async () => {
  const { pickDefaultReply } = await import('../lib/comment-style.js');
  const title = "[검단 포케 맛집] 검단 다양하고 맛있는 포케집 '슬로우캘리 검단신도시점'";
  assert.match(pickDefaultReply('remark', '정리가 쉽지않아요 ㅋㅋ ~', [], { postTitle: '이웃 정리 방법' }), /쉽지 않죠|그 마음/);
  assert.doesNotMatch(pickDefaultReply('remark', '위치 바로 지도에 켜서 저장해뒀어요 메뉴 고르기 힘들 때 여기로 가야겠어요 ㅎㅎ', [], { postTitle: title }), /쉽지 않죠|그 마음/);
});

// 2026-10-21 audit of 92 feed comments on 112: review/anchor sentences, stranger posts, accident news.
test('feed comments: no commentary voice, only neighbors, no comment on accident news', () => {
  const context = { title: '빈패스트 픽업트럭 출시', contentSnippet: 'VinFast는 올해 상반기 픽업트럭 신차를 공개했다' };
  for (const text of ['새로운 픽업트럭 모델 출시 소식을 보니 시장 변화에 빠르게 대응하는 모습이 인상적이네요.',
    'VinFast 픽업트럭이 나온다니 흥미롭네요.', 'VinFast 신차 소식을 접했습니다. 앞으로가 중요할 것 같아요.']) {
    assert.ok(checkComment(text, context, []).reasons.some((item) => item.code === 'commentary'), text);
  }
  assert.ok(!checkComment('VinFast가 픽업트럭까지 낸다니 라인업이 빠르게 늘어나네요.', context, []).reasons.some((item) => item.code === 'commentary'));
  for (const author of ['당신을 위한 추천글 새벽리더', '내 이웃의 인기글 머니타임', '내 이웃이 반응한 글 MJ소프트링크']) assert.equal(isNeighborFeedPost({ author }), false, author);
  assert.equal(isNeighborFeedPost({ author: '찌니쭈' }), true);
  for (const title of ['강릉 유천동 BMW 인도 돌진 후 전도, 4명 부상', '제주 과수원서 전동가위에 손가락 절단 사고', '광주 광산구 교차로서 버스·승합차·오토바이 충돌 사고로 2명 부상']) {
    assert.match(sensitivePostReason({ title }), /민감한 주제/, title);
  }
  assert.equal(sensitivePostReason({ title: '인천 부평 진미막창 감자막창 후기' }), '');
});