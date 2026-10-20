import { DEFAULT_COMMENTS, DEFAULT_REPLIES } from '../lib/comment-style.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkComment, checkReply, classifyComment, runHarness, styleGuidance, styleProfile } from '../lib/comment-harness.js';
import { EmbeddedLlamaServer } from '../lib/embedded-llama.js';

// Real replies the 112 server posted in October 2026, with the comment they answered.
const myPost = { postTitle: '네이버 블로그 이웃 관리 자동화 프로그램, 이웃메이트를 소개합니다', postSnippet: '이웃 새글에 댓글 달고, 받은 서로이웃 신청 정리하고, 비활성 이웃 정리까지 자율 주행으로 처리합니다. 로컬 AI로 AI 요금 0원.' };
const codes = (result) => result.reasons.map((item) => item.code);

test('reply harness rejects replies about things nobody said', () => {
  const made = checkReply('프로그램이 도움이 된다니 다행이네요. 혹시 액자에 사진을 옮기는 과정에서 막히는 부분이 생기면 언제든 또 물어봐 주세요.',
    { ...myPost, commentText: '능력자님~! 정말 큰 도움이 될 프로그램 공유받고 싶습니다~! 이웃신청했고 공감도 클릭 완료~~^^' });
  assert.ok(codes(made).includes('ungrounded'), codes(made).join());

  const claimed = checkReply('네, 포스팅 읽어주셔서 감사해요! 이웃 관리하는 데 시간 많이 쓰신다는 말씀에 저도 크게 공감했어요.',
    { ...myPost, commentText: '포스팅 잘봤습니다.' });
  assert.ok(codes(claimed).includes('misattribution'), codes(claimed).join());
});

test('reply harness rejects the author talking like a reader, and lectures', () => {
  const reader = checkReply('저도 LLM 모델들이 너무 빨리 바뀌는 것 같아 따라가기 버거울 때가 많거든요. 실무적인 관점에서 꼭 필요한 정보들만 모아주신 것 같아 좋았어요!',
    { postTitle: '2026 LLM 모델 비교', postSnippet: 'LLM 모델 비교와 실무 활용', commentText: '오늘도 유용한 정보 잘보고가요 ㅎㅎㅎ' });
  assert.ok(codes(reader).includes('reader_voice'), codes(reader).join());

  const lecture = checkReply('프로그램 자체에 대한 칭찬으로 받아들일게요. 이웃 관리 자동화도 물론 편리하지만, 결국 사람 간의 교류가 핵심이라 너무 의존하지 않으시는 게 중요할 것 같아요.',
    { ...myPost, commentText: '프로그램을 만드셨다니 대단하네요포스팅 잘보고 갑니다' });
  assert.ok(codes(lecture).includes('unsolicited_advice'), codes(lecture).join());
});

test('reply harness wants a request answered and no question back to a greeting', () => {
  assert.equal(classifyComment('포스팅 잘보고갑니다 즐거운 하루되세요'), 'greeting');
  assert.equal(classifyComment('정말 큰 도움이 될 프로그램 공유받고 싶습니다~!'), 'request');
  assert.equal(classifyComment('윈도우 7에서도 되나요?'), 'question');
  const asked = checkReply('찾아와 주셔서 반가워요. 오늘도 좋은 하루 보내세요!', { ...myPost, commentText: '이 프로그램 공유받고 싶습니다~!' });
  assert.ok(codes(asked).includes('ignored_request'), codes(asked).join());
  const quiz = checkReply('혹시 이웃메이트 쓰시면서 가장 궁금했던 기능이 있으신가요?', { ...myPost, commentText: '잘 보고 갑니다 ㅎㅎ' });
  assert.ok(codes(quiz).includes('question_on_greeting'), codes(quiz).join());
});

test('a grounded reply in the author voice passes', () => {
  const good = checkReply('반갑게 들러 주셔서 고마워요. 비활성 이웃 정리는 저도 매일 켜 두는 기능이라 편하게 쓰고 있어요.',
    { ...myPost, commentText: '비활성 이웃 정리가 되서 넘 좋으네요' });
  assert.equal(good.ok, true, codes(good).join());
  const answered = checkReply('공유 요청 고마워요. 프로그램은 3일 무료 체험으로 먼저 써 보실 수 있게 준비해 뒀어요.',
    { ...myPost, commentText: '정말 큰 도움이 될 프로그램 공유받고 싶습니다~!' });
  assert.equal(answered.ok, true, codes(answered).join());
});

// Real comments: 94 of 150 ended with 😊, 98 used 정말, many ended with "것 같아요".
const habit = [
  '비트에 든 식이 질산염이 혈관 건강에 이롭다니 정말 반가운 정보네요. 😊',
  '제주에서 1만 원대로 이용 가능한 곳도 있다니 정말 유용한 정보가 될 것 같아요. 😊',
  '쏘팔메토 성분이 탈모에 도움이 되는지는 정말 궁금하네요. 꾸준한 관리가 중요할 것 같아요! 😊',
  '아이 명의 계좌로 장기투자하는 포트폴리오 구성이 정말 중요할 것 같아요! 😊',
  '어린이집 운영비 예산이 꼼꼼하게 배분되는 것이 정말 중요할 것 같아요. 😊',
  '학교 2013 인연의 두 분이 슈돌에 나온다니 정말 반갑네요. 😊'
];

test('comment harness catches the habits the recent comments already overused', () => {
  const profile = styleProfile(habit);
  assert.ok(profile.emojiHeavy);
  assert.ok(profile.endings.includes('것 같아요'));
  assert.ok(profile.words.includes('정말'));
  const again = checkComment('캠핑 의자 수납 팁을 정말 꼼꼼하게 정리해 주셔서 다음 캠핑에 큰 도움이 될 것 같아요. 😊',
    { title: '캠핑 의자 수납 팁', contentSnippet: '캠핑 의자를 접어 수납하는 방법' }, habit);
  for (const code of ['emoji_habit', 'same_ending', 'overused_word', 'stock']) assert.ok(codes(again).includes(code), `${code}: ${codes(again).join()}`);
  const fresh = checkComment('의자 다리를 먼저 접고 커버에 넣는 순서가 핵심이었군요. 캠핑 의자 수납이 이렇게 간단할 줄 몰랐어요.',
    { title: '캠핑 의자 수납 팁', contentSnippet: '캠핑 의자를 접어 수납하는 방법' }, habit);
  assert.equal(fresh.ok, true, codes(fresh).join());
});

test('comment harness rejects invented reader context the old validator missed', () => {
  const result = checkComment('비트를 생으로 섭취할지 익혀 먹을지 궁금했는데 많은 도움이 돼요.', { title: '비트 효능', contentSnippet: '비트에 든 질산염과 베타레인' });
  assert.ok(codes(result).includes('unsupported_reader_context'), codes(result).join());
});

test('style guidance tells the model what to avoid this time', () => {
  const hints = styleGuidance(habit, { random: () => 0.9 }).join('\n');
  assert.match(hints, /것 같아요/);
  assert.match(hints, /정말/);
  assert.match(hints, /이모지를 쓰지 마세요/);
});

test('runHarness feeds the reasons back and returns the first answer that passes', async () => {
  const answers = ['좋은 정보 잘 보고 갑니다!', '의자 다리를 먼저 접고 커버에 넣는 순서가 핵심이었군요. 캠핑 의자 수납이 간단해 보여요.'];
  const seen = [];
  const result = await runHarness({
    messages: [{ role: 'user', content: 'write' }],
    complete: async (turn) => { seen.push(turn); return answers[seen.length - 1]; },
    check: (text) => checkComment(text, { title: '캠핑 의자 수납 팁', contentSnippet: '캠핑 의자를 접어 수납하는 방법' }, [])
  });
  assert.equal(result.text, answers[1]);
  assert.equal(result.attempts.length, 1);
  assert.match(seen[1].at(-1).content, /거절됐습니다[\s\S]*아무 글에나 쓰는 말/);
});

test('generateBlogComment falls back to a default comment after three rejected answers and remembers what it wrote', async () => {
  const server = new EmbeddedLlamaServer({ appRoot: process.cwd() });
  let calls = 0;
  server.chatCompletion = async () => { calls += 1; return '좋은 정보 잘 보고 갑니다! 정말 유익해요.'; };
  const fallback = await server.generateBlogComment({ title: '캠핑 의자 수납 팁', contentSnippet: '캠핑 의자를 접어 수납하는 방법' });
  assert.ok(DEFAULT_COMMENTS.includes(fallback), fallback);
  assert.equal(server.lastCommentKind, 'default');
  assert.equal(calls, 3);
  assert.match(server.lastCommentFailure, /stock/);

  server.chatCompletion = async () => '의자 다리를 먼저 접고 커버에 넣는 순서가 핵심이었군요. 캠핑 의자 수납이 간단해 보여요.';
  const text = await server.generateBlogComment({ title: '캠핑 의자 수납 팁', contentSnippet: '캠핑 의자를 접어 수납하는 방법' });
  assert.ok(text);
  // The next post gets a different sentence: the same one is now a duplicate.
  calls = 0;
  server.chatCompletion = async () => { calls += 1; return text; };
  assert.ok(DEFAULT_COMMENTS.includes(await server.generateBlogComment({ title: '캠핑 의자 수납 팁 2', contentSnippet: '캠핑 의자를 접어 수납하는 방법' })));
  assert.equal(calls, 3);
});

test('generateCommentReply retries with the reasons; greetings and remarks get a set reply without the model', async () => {
  const server = new EmbeddedLlamaServer({ appRoot: process.cwd() });
  const prompts = [];
  const replies = ['비활성 이웃 정리도 돼요. 궁금한 점 있으시면 언제든 물어봐 주세요!', '네, 비활성 이웃 정리도 자율 주행으로 같이 처리해요. 관심 가져 주셔서 고마워요.'];
  server.chatCompletion = async (messages) => { prompts.push(messages); return replies[prompts.length - 1]; };
  const reply = await server.generateCommentReply({ ...myPost, commentText: '비활성 이웃 정리도 자율 주행으로 되나요?', commenterName: '이웃' });
  assert.equal(reply, replies[1]);
  assert.match(prompts[1].at(-1).content, /상투적인/);

  server.chatCompletion = async () => { throw new Error('a greeting must not reach the model'); };
  assert.ok(DEFAULT_REPLIES.greeting.includes(await server.generateCommentReply({ ...myPost, commentText: '잘 보고 가요', commenterName: '이웃' })));
  server.chatCompletion = async () => '도움이 되셨다니 다행이에요. 궁금한 점 있으시면 언제든 물어봐 주세요!';
  await assert.rejects(server.generateCommentReply({ ...myPost, commentText: '이 프로그램은 맥에서도 되나요?', commenterName: '이웃' }), /stock/);
});

test('reply harness rejects guesses about the commenter, explanations, and claims they never made', () => {
  const post = { postTitle: 'Unity DOTS 우주 슈팅 게임', postSnippet: 'Unity DOTS와 Netcode for Entities로 만든 3D 멀티플레이어 고성능 구현' };
  assert.equal(classifyComment('안녕하세요! 따뜻한 글 잘 읽고 갑니다 😊'), 'greeting');
  assert.equal(classifyComment('흥미롭게 잘 읽고 갑니다 😊 다음 포스팅도 기대할게요!'), 'greeting');
  const guess = checkReply('네, 독자분께서도 이런 종류의 고성능 구현에 관심이 많으신 것 같네요.', { ...post, commentText: '안녕하세요! 따뜻한 글 잘 읽고 갑니다 😊' });
  assert.ok(codes(guess).includes('presumption'), codes(guess).join());
  const meta = checkReply('글에 언급된 내용은 Unity DOTS와 Netcode for Entities를 활용한 3D 멀티플레이어 프로젝트입니다.', { ...post, commentText: '연휴라 블로그 들어오기 쉽지 않네요' });
  assert.ok(codes(meta).includes('meta'), codes(meta).join());
  const claim = checkReply('연휴가 이어지니 블로그 방문이 쉽지 않으시군요. 꾸준한 포스팅으로 힘을 받으셨다니 다행입니다.',
    { ...post, commentText: '연휴가 계속되니 블로그 들어오는게 쉽지않네요!! 또 블로그는 미뤄지는 그런' });
  assert.ok(codes(claim).includes('misattribution'), codes(claim).join());
});

test('the last attempt may break only a style rule, never a content rule', async () => {
  const context = { title: '인덕원역 4중 환승', contentSnippet: '4호선 월판선 인동선 GTX-C 인덕원역' };
  const recent = ['정말 좋네요 A', '정말 좋네요 B', '정말 반갑네요 C', '정말 유용해요 D', '정말 멋져요 E', '정말 귀엽네요 F'];
  const styleOnly = '월판선과 인동선까지 이어지면 인덕원역이 정말 큰 환승 거점이 되겠어요.';
  const result = await runHarness({ messages: [], complete: async () => styleOnly, check: (text) => checkComment(text, context, recent) });
  assert.equal(result.text, styleOnly);
  assert.deepEqual(result.relaxed, ['overused_word']);
  const stock = await runHarness({ messages: [], complete: async () => '좋은 정보 잘 보고 갑니다! 인덕원역 기대돼요.', check: (text) => checkComment(text, context, []) });
  assert.equal(stock.text, '');
});

test('a reply must answer the comment, and a greeting gets a greeting, not my post', () => {
  // Real failure on 2026-10-17 under the 서이추 guide post.
  const guide = { postTitle: '서이추 하루 제한 100명, 거절 안 당하는 서로이웃 신청 멘트와 이웃 정리법', postSnippet: '서로이웃 신청은 하루 100명까지 보낼 수 있습니다.' };
  const hello = '포스팅 잘 보고 갑니다~\n당신을 응원합니다~\n좋은 가을 날씨네요.\n행복한  주말보내세요~^^ 🌿';
  assert.equal(classifyComment(hello), 'greeting');
  const bad = checkReply('저도 하루 제한 걸린 걸 직접 겪어보니 이 부분이 정말 중요하더라고요.', { ...guide, commentText: hello });
  assert.ok(codes(bad).includes('post_on_greeting'), codes(bad).join());
  const topic = checkReply('서로이웃 신청 멘트는 짧게 쓰는 게 좋더라고요.', { ...guide, commentText: hello });
  assert.ok(codes(topic).includes('post_on_greeting'), codes(topic).join());
  for (const good of ['응원 감사해요! 선선한 가을 날씨처럼 행복한 주말 보내세요.', '따뜻한 인사 고마워요. 이웃님도 좋은 주말 되세요.']) {
    assert.deepEqual(codes(checkReply(good, { ...guide, commentText: hello })), [], good);
  }
  const busy = '즐겁고 보람찬하루 보내세요';
  assert.equal(classifyComment('포스팅 잘 보고 갑니당 ~~♥'), 'greeting');
  assert.deepEqual(codes(checkReply('들러 주셔서 고마워요. 또르르님도 좋은 하루 보내세요!', { ...guide, commentText: '포스팅 잘 보고 갑니당 ~~♥' })), []);
  assert.equal(classifyComment(busy), 'greeting');
  assert.ok(codes(checkReply('뚜벅이리포터님도 오늘 기분 좋은 하루 보내시길 바라요. 포스팅에 적어둔 AI 툴로 썸네일을 직접 만들어 보시면 작업 시간 줄이는 데 제법 쏠쏠할 거예요.',
    { postTitle: '포토샵 없이 1분 만에 블로그 썸네일과 상품 이미지 만드는 생성형 AI 활용 가이드', postSnippet: '', commentText: busy })).includes('post_on_greeting'));
  const remark = '정리가 쉽지않아요 ㅋㅋ ~';
  assert.equal(classifyComment(remark), 'remark');
  assert.ok(codes(checkReply('바쁘신 와중에 들러주셔서 감사해요.', { ...guide, commentText: remark })).includes('unresponsive'));
  assert.deepEqual(codes(checkReply('맞아요, 이웃 정리가 생각보다 손이 많이 가더라고요.', { ...guide, commentText: remark })), []);
  const visit = '오늘도 좋은글 감사해요~~답방 와주실거죠?💚';
  assert.ok(codes(checkReply('네, 방문해주셔서 감사해요.', { ...guide, commentText: visit })).includes('ignored_request'));
  assert.ok(!codes(checkReply('찾아와 주셔서 감사해요. 저도 꼭 들를게요!', { ...guide, commentText: visit })).includes('ignored_request'));
  assert.equal(classifyComment('카멜클라우드 pc용 배포 요청드립니다.'), 'request');
  const changed = checkReply('서로이웃 신청은 하루 100명까지라서 천천히 늘리는 게 좋아요.', { ...guide, commentText: '캠핑 장비 고르는 게 제일 어렵더라고요' });
  assert.ok(codes(changed).includes('unresponsive'), codes(changed).join());
});
