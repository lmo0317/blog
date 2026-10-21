// Replies to comments on my own posts, built from what the visitor actually said: the dish or topic they named,
// what they liked (맛, 양, 사진, 정보, 정성), what they plan (가 보기, 따라 해 보기), a visit, their cheer, and the
// day, season or weather in their greeting. 2026-10-21: 15 set lines rotated under every comment read as a bot
// ("예쁘게 봐 주셔서" under an info post, "좋은 말씀 남겨 주셔서" 16 times), and E2B writing freely passed the
// checks for only 63 of 167 real comments, several of those still wrong. This answers each comment in its own terms.
import { commentSimilarity, normalizeCommentText } from './comment-prompt.js';
import { commentTopic } from './comment-style.js';
import { classifyComment } from './comment-harness.js';

// 을/를, 이/가, 은/는, 과/와, 으로/로 after a word.
function batchim(word) {
  const last = String(word).trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return /[136780lmnr]$/i.test(last);
  return code % 28 !== 0;
}
export const josa = (word, pair) => {
  const [withFinal, without] = pair.split('/');
  return `${word}${batchim(word) ? withFinal : without}`;
};

// A thing the visitor named that my post names too ("육회포케", "메밀면", "서이추"), longest first; not words any comment has.
const ITEM_STOP = /^(?:포스팅|포스트|정보|사진|오늘|하루|내용|정성|글|블로그|이웃|이웃님|잇님|댓글|감사|좋은|정말|너무|진짜|완전|우와|덕분|저도|여기|거기|이런|저런|그런|다음|처음|한번|요즘|주말|건강|맛집|후기|추천|방문|위치|메뉴|분위기|비주얼|양도|양이|가격|시간|생각|마음|조합|자주|보고|잘|많이|다시|항상|계속|같이|함께|바로|먼저|이렇게|그렇게|당장|활동|기억|참고)$/;
export function itemFromPost(commentText = '', postText = '') {
  const post = normalizeCommentText(postText).replace(/\s/g, '');
  const words = (normalizeCommentText(commentText).match(/[가-힣A-Za-z0-9]{2,}/g) || [])
    .map((word) => word.replace(/(?:에서|으로|이랑|까지|부터|처럼|이라니|라니|이에요|예요|이네요|네요|은|는|이|가|을|를|에|의|로|와|과|도|만|랑)$/, ''))
    .filter((word) => word.length >= 2 && word.length <= 8 && !ITEM_STOP.test(word) && !/(?:하|했|해|되|돼|있|없|같|겠|보이|싶|어요|아요|네|요)$/.test(word) && post.includes(word));
  return words.sort((a, b) => b.length - a.length)[0] || '';
}

/** What a visitor's comment says, as flags the reply can answer. */
export function readComment(commentText = '', { postTitle = '', postSnippet = '' } = {}) {
  const text = normalizeCommentText(commentText);
  const has = (re) => re.test(text);
  const holiday = (text.match(/추석|설날|명절|크리스마스|성탄|연휴|한글날|개천절|어린이날|휴일|공휴일/) || [])[0] || '';
  return {
    text,
    // Only for food: "육회포케는 실제로도 정말 맛있었어요". Elsewhere a picked word read badly ("철이라 부분", "갑니다 부분").
    dish: commentTopic(text, postTitle) || itemFromPost(text, `${postTitle} ${postSnippet}`),
    // "늦어도 답방 꼭 갑니다", "답방 다녀갑니다": they come to me, which is not asking me to come.
    visitedBack: has(/답방 ?(?:왔|와 ?(?:요|습니다)|다녀|갑니다|가요|드려|드립|꼭 ?갈|꼭 ?갑|갈게|올게)/),
    impressed: has(/대단|신기|놀랍|멋지|멋있|효율적|있군요|있네요|있었네|잇네요|편리|편하겠/),
    visitAsk: has(/답방 ?(?:부탁|와 ?주|오세요|요(?![가-힣])|환영)|놀러 ?(?:와|오세요|오시)|와 ?주세요|와 ?주실|와 ?주시면|들러 ?주|방문(?:해)? ?주/),
    neighborAdd: has(/이웃 ?신청 ?(?:했|하고|드려|드렸|남겨|넣|살짝|보냈|합니다|해요)|서이추 ?(?:감사|했|드려|드렸|신청|해요|합니다|하고)|이웃 ?추가 ?(?:했|하고|드려)/),
    complaint: has(/아쉽|아쉬웠|비싸|별로|실망|불친절|짜더|싱겁/),
    willVisit: has(/(?:자주|또|종종|가끔|매일) ?(?:놀러|들를|올게|올께|와야|찾아|방문)|놀러 ?올게|놀러 ?올께|또 올게|자주 올|소통해요|자주 소통/),
    cheer: has(/응원|화이팅|파이팅|힘내|대박 나/),
    tasty: has(/맛있|맛나|맛집|먹고 ?싶|침 ?고|군침|땡기|땡길|당기네|입맛|매콤|달달|고소|조합/),
    portion: has(/양이|양도|푸짐|한가득|든든|배부|포만감/),
    visual: has(/예쁘|이쁘|사진|비주얼|깔끔|분위기|감성/),
    info: has(/정보|유익|유용|도움|알찬|꿀팁|팁|배우|알아갑|알고 ?갑|몰랐|새롭|궁금했|방법/),
    effort: has(/정성|꼼꼼|자세|상세|사세|디테일|섬세|정리(?:된|해 ?주|하신|가 잘)|잘 ?정리/),
    wantsToGo: has(/가 ?봐야|가 ?볼래|가 ?보고 ?싶|가봐야|가볼|가보고|방문해 ?보|들러 ?봐|찜|저장|메모|지도에|가야겠/) && /맛집|카페|식당|후기|여행|가게|매장|위치|주차|다녀|방문/.test(`${postTitle} ${postSnippet}`),
    wantsToTry: has(/해야겠|해 ?봐야|해봐야|따라 ?해|써 ?봐야|써봐야|시도해|기억해|참고|챙겨야|바꿔 ?봐야|해 ?볼게|해볼게|적용해/),
    struggle: has(/쉽지 ?않|어렵|힘들(?!\s?때)|막막|번거롭|귀찮/) && !/고르기 힘들|힘들 때/.test(text),
    shared: has(/저도|저 역시|나도|공감/),
    monday: has(/월요일|한 ?주(?:를)? 시작|한주 시작|새로운 한 ?주|이번 ?주도|한 ?주 ?(?:되|보내)/),
    weekendEnd: has(/주말 마지막|일요일 (?:저녁|밤)/),
    weekend: has(/주말|불금|금요일|토요일|일요일/),
    holiday,
    evening: has(/저녁|좋은 밤|굿밤|편안한 밤|밤 (?:되|보내)/),
    morning: has(/아침 ?인사|좋은 아침|이른 아침/),
    cold: has(/추워|추운|쌀쌀|따뜻하게 입|기온이 (?:내려|떨어)|날이 차/),
    coldSeason: has(/환절기|감기|건강 ?(?:관리|조심|챙기)/),
    rain: has(/비가 (?:와|오|내리|많이)|비 소식|비 오는 (?:월요일|화요일|수요일|목요일|금요일|주말|아침|저녁|하루|날이네)|비와서|돌풍|장마/),
    niceDay: has(/하늘|날씨(?:가)? 좋|좋은 날씨|가을 날씨|맑|화창|선선|햇살/)
  };
}

function pick(pool, recent, random) {
  const fresh = pool.filter((line) => !recent.some((previous) => commentSimilarity(line, previous) >= 0.55));
  const choices = fresh.length ? fresh : pool;
  return choices[Math.floor(random() * choices.length)];
}

/** A reply in my own voice that answers this comment, unlike the recent replies. */
export function composeReply(commentText, { postTitle = '', postSnippet = '', recentReplies = [], random = Math.random } = {}) {
  const c = readComment(commentText, { postTitle, postSnippet });
  const recent = recentReplies.map((reply) => normalizeCommentText(reply)).filter(Boolean).slice(0, 20);
  const parts = [];
  // Not their own sentence handed back ("좋은 밤 보내세요" → "좋은 밤 보내세요"): it reads as a copy.
  const letters = (value) => normalizeCommentText(value).replace(/[^가-힣A-Za-z0-9]/g, '');
  const theirs = c.text.split(/[.!?~^…\n]+/).map(letters).filter((part) => part.length >= 4);
  const own = (line) => !theirs.some((part) => letters(line).includes(part) || part.includes(letters(line).replace(/이웃님도/g, '')));
  const add = (pool) => { const usable = pool.filter(own); const line = pick(usable.length ? usable : pool, [...recent, ...parts], random); if (line) parts.push(line); };
  const dish = c.dish && c.dish.length <= 10 ? c.dish : '';

  // 1. What they said about the post.
  if (c.complaint) add(['솔직한 이야기 고마워요.', '솔직하게 말씀해 주셔서 감사해요.', '그 부분은 저도 조금 아쉬웠어요.']);
  else if (c.tasty && dish) add([`${josa(dish, '은/는')} 실제로도 정말 맛있었어요!`, `${josa(dish, '은/는')} 또 먹고 싶을 만큼 맛있었어요 ㅎㅎ`, `${dish} 진짜 맛있게 먹었어요.`, `${josa(dish, '이/가')} 제일 기억에 남아요 ㅎㅎ`]);
  else if (c.tasty && c.portion) add(['양도 넉넉하고 맛도 좋아서 든든했어요!', '푸짐하고 맛있어서 배부르게 먹었어요 ㅎㅎ']);
  else if (c.portion) add(['양이 정말 넉넉해서 든든했어요.', '양이 많아서 배부르게 먹고 왔어요 ㅎㅎ']);
  else if (c.tasty) add(['보이는 것만큼 맛있었어요 ㅎㅎ', '실제로도 정말 맛있었어요!', '맛있게 봐 주셔서 고마워요!']);
  else if (c.struggle && !c.info) add(['맞아요, 쉽지 않죠.', '저도 그 마음 알아요.', '그쵸, 생각보다 손이 많이 가요.']);
  else if (c.wantsToTry && !c.wantsToGo) add(['하나씩 해 보시면 분명 달라지는 게 보일 거예요.', '조금씩 해 보시면 금방 익숙해지실 거예요.', '천천히 하나씩 해 보세요, 응원할게요!']);
  else if (c.visual) add(['예쁘게 봐 주셔서 고마워요!', '사진 좋게 봐 주셔서 기분 좋아요 ㅎㅎ']);
  else if (c.effort) add(['정성 알아봐 주셔서 고마워요.', '꼼꼼히 읽어 주셔서 감사해요.', '열심히 정리한 보람이 있네요 ㅎㅎ']);
  else if (c.info) add(['필요하실 때 꺼내 보시면 좋겠어요.', '쓸모 있게 읽어 주셔서 고마워요.', '도움이 되면 좋겠어요.', '잘 활용하시면 좋겠어요.', '유익하게 봐 주셔서 기뻐요.', '다음 글도 열심히 준비할게요.', '필요할 때 다시 찾아 주세요 :)']);
  else if (c.cheer) add(['응원 덕분에 힘이 나요!', '응원 고마워요, 힘내서 또 올릴게요!', '응원해 주셔서 든든해요.']);
  else if (c.impressed) add(['좋게 봐 주셔서 고마워요!', '관심 가져 주셔서 감사해요.', '신기하게 봐 주셔서 고마워요 ㅎㅎ']);
  else if (!(c.visitedBack || c.visitAsk || c.neighborAdd)) add(['들러 주셔서 고마워요.', '댓글 반가워요!', '찾아와 주셔서 감사해요.', '잘 봐 주셔서 고마워요.', '읽어 주셔서 고마워요 :)', '댓글 남겨 주셔서 고마워요.']);

  // 2. What they plan to do, or a visit.
  if (c.wantsToGo) add(['나중에 꼭 가 보세요!', '근처 가실 일 있으면 꼭 들러 보세요.', '가 보시면 후회 안 하실 거예요 ㅎㅎ']);

  if (c.visitedBack) add(['답방 와 주셔서 고마워요!', '와 주셔서 반가워요, 저도 놀러 갈게요!']);
  else if (c.visitAsk) add(['저도 꼭 놀러 갈게요!', '시간 내서 들를게요 :)', '저도 곧 찾아갈게요!']);
  if (c.neighborAdd) add(['이웃 신청도 고마워요!', '이웃으로 자주 소통해요 :)']);
  else if (c.willVisit) add(['자주 와 주신다니 든든해요!', '언제든 편하게 놀러 오세요 :)', '자주 소통해요!']);
  else if (c.cheer && parts.length && !/응원/.test(parts[0])) add(['응원도 고마워요!', '응원 덕분에 힘이 나요.']);

  // 3. Their greeting answered in kind: the day, the season, the weather; a plain wish when they gave none.
  if (parts.length < 3) {
    if (c.holiday) add([`${c.holiday} 즐겁게 보내세요!`, `이웃님도 행복한 ${c.holiday} 보내세요!`]);
    else if (c.weekendEnd) add(['주말 마지막 날도 알차게 보내세요!', '남은 주말 편안하게 마무리하세요.']);
    else if (c.monday) add(['이웃님도 힘찬 한 주 시작하세요!', '이번 주도 좋은 일 가득하세요!']);
    else if (c.weekend) add(['남은 주말도 즐겁게 보내세요!', '편안한 주말 보내세요 :)']);
    else if (c.cold) add(['날이 쌀쌀해졌는데 이웃님도 따뜻하게 입으세요!', '아침저녁으로 쌀쌀하죠, 감기 조심하세요!']);
    else if (c.coldSeason) add(['이웃님도 환절기 감기 조심하세요!', '이웃님도 건강 잘 챙기세요.']);
    else if (c.rain) add(['궂은 날씨에 이웃님도 건강 챙기세요.', '날씨가 오락가락하네요, 감기 조심하세요!']);
    else if (c.niceDay) add(['날씨 좋은 날 즐겁게 보내세요!', '좋은 날씨처럼 좋은 일만 가득하세요!']);
    else if (c.evening) add(['편안한 저녁 보내세요.', '좋은 밤 보내세요 :)']);
    else if (c.morning) add(['이웃님도 기분 좋은 하루 시작하세요!']);
    else if (parts.length < 2) add(['오늘도 좋은 하루 보내세요!', '남은 하루도 편안하게 보내세요.', '행복한 하루 되세요 :)', '오늘 하루도 기분 좋게 보내세요!', '즐거운 하루 보내세요 ㅎㅎ', '좋은 일 가득한 하루 되세요!', '오늘도 웃는 일 많으시길 바라요.']);
  }
  return parts.slice(0, 3).join(' ');
}

/** A comment with something of its own to answer (an opinion, a story) that none of the composed lines covers. */
export function needsOwnAnswer(commentText = '', context = {}) {
  const c = readComment(commentText, context);
  const covered = c.complaint || c.tasty || c.portion || c.visual || c.info || c.effort || c.cheer || c.wantsToGo || c.wantsToTry || c.struggle || c.visitAsk || c.visitedBack || c.neighborAdd
    // A bare "대단하네요" is covered; a longer opinion around it is theirs to be answered.
    || (c.impressed && c.text.length < 40);
  // Letters beyond the greeting words: "서이추 중요하죵 하지만 교류하지 않으면 의미가 없더라고요" has a point of its own.
  const plain = c.text.replace(/포스팅|잘 ?보고 ?(?:갑니다|가요|가용)|감사(?:합니다|해요)|좋은 하루[^.!~]*|행복한[^.!~]*|[^가-힣\s]/g, '').replace(/\s+/g, ' ').trim();
  const greeting = classifyComment(c.text) === 'greeting' || c.holiday || c.weekend || c.weekendEnd || c.monday || c.morning || c.evening || c.cold;
  return !covered && !greeting && plain.length >= 20;
}
