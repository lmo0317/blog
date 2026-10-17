// Comment harness: every AI comment and reply goes through write → check → rewrite with the reasons → skip.
// The checks come from real failures on the 112 server (2026-10): replies about things nobody said
// ("액자에 사진을 옮기는 과정"), the author talking like a reader ("정보를 모아주신 것 같아 좋았어요"),
// lecturing the commenter ("너무 의존하지 않으시는 게 중요"), and comments that all sounded the same
// (94 of 150 ended with 😊, 98 used "정말", 25 ended with "것 같아요").
import { commentSimilarity, contentKeywords, normalizeCommentText, validateBlogComment } from './comment-prompt.js';

export const HARNESS_VERSION = 'comment-harness-v2';
export const MAX_ATTEMPTS = 3;

const EMOJI = /\p{Extended_Pictographic}/gu;
const TRAILING_EMOJI = /\p{Extended_Pictographic}[\s!.~]*$/u;

// Generic praise any bot could leave under any post.
const STOCK_COMMENT = /좋은 정보|잘 보고 (?:갑니다|가요)|잘 읽고 (?:갑니다|가요)|유익한 (?:정보|글|포스팅)|좋은 인사이트|큰 도움이 (?:됐|되었|돼|될)|정말 중요할 것 같|한눈에 (?:보기|파악|짚어|정리)|일목요연|정성스러운 (?:글|포스팅)|소통해요|자주 놀러/;
const STOCK_REPLY = /도움이 되셨다니|궁금한 점 (?:있으시면|생기시면)|궁금하신 점 있으면|유용한 정보로 찾아뵐|따뜻한 댓글 감사|언제든 (?:편하게 )?(?:물어|여쭤|말씀)/;
// The author must not sound like a reader of their own post.
const READER_VOICE = /(?:정리|공유|소개|설명|모아|짚어|알려|추천)(?:해)? ?주(?:셔서|신|시니)|좋은 (?:글|포스팅|정보) (?:감사|잘)|잘 보고 (?:갑니다|가요)|덕분에 (?:알게|배워|새로)|포스팅 (?:덕분|잘 봤)/;
// Advice or a lesson nobody asked for.
const UNSOLICITED_ADVICE = /(?:너무|과도하게) (?:의존|집착|관리하려)|(?:하지 않으시는|안 하시는|않는) 게 (?:중요|좋)|초점을 맞추시는 게|(?:하시는|하시면) 게 (?:더 )?(?:좋을|나을|중요)|(?:지치지|무리하지) 않도록|적당한 선을/;
// The reply claims the commenter said something ("…신다는 말씀", "…셨다니").
const ATTRIBUTION = /([가-힣A-Za-z0-9 ]{2,30}?)(?:신다는|하신다는|다는) 말씀|([가-힣A-Za-z0-9 ]{2,30}?)(?:셨다니|하셨다니|되셨다니|이셨다니)/g;

// Endings that turn every comment into the same sentence.
const ENDING_FAMILIES = [
  ['것 같아요', /것 같(?:아요|네요|습니다)[\s\p{Extended_Pictographic}!.~]*$/u],
  ['기대돼요', /기대(?:돼요|되네요|됩니다|가 돼요)[\s\p{Extended_Pictographic}!.~]*$/u],
  ['해야겠어요', /(?:해|봐|챙겨|확인해|살펴)야겠(?:어요|네요)[\s\p{Extended_Pictographic}!.~]*$/u],
  ['도움이 돼요', /도움이 (?:돼요|되네요|됐어요|되었어요|될 것)[\s\p{Extended_Pictographic}!.~]*/u],
  ['바랄게요', /(?:바랄게요|바라요|응원할게요)[\s\p{Extended_Pictographic}!.~]*$/u],
  ['기분이에요', /기분이(?:에요|네요|드네요)[\s\p{Extended_Pictographic}!.~]*$/u],
  ['궁금해지네요', /궁금(?:해지네요|해집니다|하네요)[\s\p{Extended_Pictographic}!.~]*$/u],
  ['좋네요', /좋(?:네요|겠어요|겠네요)[\s\p{Extended_Pictographic}!.~]*$/u],
  ['다행이에요', /다행(?:이에요|이네요|입니다)[\s\p{Extended_Pictographic}!.~]*/u],
  ['질문으로 끝남', /\?[\s\p{Extended_Pictographic}]*$/u]
];
// Words that crept into almost every comment.
const BUDGET_WORDS = [['정말', /정말/], ['덕분에', /덕분에/], ['~다니/라니', /[가-힣](?:다니|라니) /], ['혹시', /혹시/], ['참 ', /(?:^| )참 /]];

const JOSA = /(?:에서|에게|으로|이랑|부터|까지|처럼|보다|이나|에는|에도|은|는|이|가|을|를|에|의|로|와|과|도|만|랑|께)$/;
// Words a reply may use without the comment or post containing them.
const COMMON_WORDS = new Set(('하루 오늘 내일 주말 날씨 댓글 답글 포스팅 블로그 이웃 소통 말씀 시간 도움 부분 내용 정보 마음 응원 감사 방문 이야기 생각 '
  + '다음 이번 처음 기분 하루하루 요즘 저도 제가 저는 우리 다들 모두 서로 정성 칭찬 관심 공감 반응 질문 궁금증 답방 신청 기능 글 사진 '
  + '기록 경험 시작 정리 준비 소식 계절 환절기 감기 건강 하루도 행복 즐거움 기대 고민 걱정 노력 꾸준 습관 변화 방법 기회 덕분 의견 '
  + '이웃님 분들 앞으로 다음번 나중 금방 자주 계속 처음부터 여유 일상 저녁 아침 오후 밤 이웃분 프로그램 앱 홈페이지 링크').split(' '));

// Guessing what the commenter likes or feels when they only said hello.
const PRESUMPTION = /관심이 (?:많으신|많으시|있으신)|좋아하시는 것 같|(?:하시는|이신|많으신|있으신) 것 같(?:네요|아요|습니다)|(?:하셨|셨)던 것 같/;
// The model explaining instead of replying.
const META = /^(?:답글|대댓글|댓글|답변)\s*[:：]|글에 언급된 내용은|이 글은 .{2,40}(?:에 대한|에 관한) 내용|(?:요청|댓글)하신 내용은/;
// Words of a plain greeting ("안녕하세요! 따뜻한 글 잘 읽고 갑니다", "포스팅 잘보고 가요 오늘도 화이팅").
const GREETING_WORD = /^(?:안녕|반가|따뜻|정성|읽고|읽었|잘|좋은|좋아요|즐거운|행복|감사|고마|보고|봤|갑니다|가요|가네요|하세요|되세요|보내세요|포스팅|정보|오늘도|항상|들렀|다녀|응원|힘내|화이팅|파이팅|소통|이웃님|흥미|유익|유용|재밌|재미|기대|다음|자주|또|ㅎ|ㅋ|\^)/;
// Small talk that rides along with a greeting ("좋은 가을 날씨네요", "행복한 주말보내세요", "당신을 응원합니다").
const SMALL_TALK = /^(?:당신|가을|봄|여름|겨울|날씨|주말|휴일|연휴|명절|추석|설날|한주|일주일|하루|저녁|아침|오후|월요일|화요일|수요일|목요일|금요일|토요일|일요일|불금|쌀쌀|선선|추운|추워|더운|더워|맑|비가|비오|눈이|평안|편안|건강하|즐겁|힘찬|활기)/;
// A reply to a greeting may answer with greeting words instead of repeating the commenter's.
const GREETING_REPLY = /감사|고맙|고마|반가|응원|와 ?주|들러 ?주|찾아 ?주|찾아올|들고 올|뵐게|뵙|방문|봐 ?주|읽어 ?주|힘이|기쁘|기뻐|뿌듯|하루|주말|한 주|저녁|시간 보내|보내세요|되세요|바랍니다|바랄게요|행복/;
// Style rules: on the last attempt an answer that breaks only these is still better than skipping.
// A greeting gets a short thank-you, so a reply like the last one is fine when nothing else passes.
export const SOFT_CODES = new Set(['same_opening', 'same_ending', 'overused_word', 'emoji_habit', 'similar_greeting']);
// Words too general to prove the commenter said something.
const CLAIM_STOP = new Set(['말씀', '정말', '너무', '많이', '조금', '이렇게', '그렇게', '저도', '제가']);

const firstWord = (text) => normalizeCommentText(text).replace(/^[\p{Extended_Pictographic}\s"'“”‘’]+/u, '').split(' ')[0] || '';
const stems = (text) => (normalizeCommentText(text).match(/[가-힣A-Za-z0-9]{2,}/g) || [])
  .map((word) => word.replace(JOSA, ''))
  .filter((word) => word.length >= 2);

/** How the recent comments sound: which endings, words and emoji habits are already overused. */
export function styleProfile(recent = []) {
  const last = recent.map((text) => normalizeCommentText(text)).filter(Boolean).slice(0, 20);
  const last10 = last.slice(0, 10);
  const share = (re, list = last) => (list.length ? list.filter((text) => re.test(text)).length / list.length : 0);
  return {
    count: last.length,
    openings: new Set(last.slice(0, 15).map(firstWord).filter(Boolean)),
    endings: ENDING_FAMILIES.filter(([, re]) => last10.filter((text) => re.test(text)).length >= 3).map(([name]) => name),
    words: BUDGET_WORDS.filter(([, re]) => share(re) >= 0.3).map(([name]) => name),
    emojiHeavy: last10.length >= 4 && share(TRAILING_EMOJI, last10) >= 0.5
  };
}

/** Hints for the prompt so the model avoids what the checks would reject anyway. */
export function styleGuidance(recent = [], { random = Math.random } = {}) {
  const profile = styleProfile(recent);
  const hints = [];
  if (profile.endings.length) hints.push(`최근 댓글이 ${profile.endings.map((name) => `"${name}"`).join(', ')}(으)로 자주 끝났습니다. 이번에는 다른 말로 끝내세요.`);
  if (profile.words.length) hints.push(`이번 댓글에는 ${profile.words.map((name) => `"${name.trim()}"`).join(', ')}을(를) 쓰지 마세요.`);
  if (profile.emojiHeavy || random() < 0.5) hints.push('이번 댓글에는 이모지를 쓰지 마세요.');
  const openings = [...profile.openings].slice(0, 6);
  if (openings.length) hints.push(`첫 단어로 ${openings.map((word) => `"${word}"`).join(', ')}는 쓰지 마세요.`);
  const angles = [
    '글에서 가장 구체적인 숫자나 이름 하나를 짚어 짧게 반응하세요.',
    '글쓴이가 들인 수고(직접 해 본 과정, 비교, 사진)를 한 가지 알아봐 주세요.',
    '글을 읽고 새로 알게 된 점 하나를 내 말로 짧게 말하세요.',
    '글 속 장면이나 상황 하나에 공감하는 한마디로 시작하세요.',
    '한 문장으로 짧고 담백하게 쓰세요.'
  ];
  hints.push(angles[Math.floor(random() * angles.length)]);
  return hints;
}

const reason = (code, fix) => ({ code, fix });

/** Every rule a comment on someone else's post must pass. */
export function checkComment(text, context = {}, recent = []) {
  const base = validateBlogComment(text, context, recent);
  const clean = base.text;
  if (base.action === 'skip') return { ok: true, text: clean, reasons: [], action: 'skip' };
  const keywords = contentKeywords(context).slice(0, 6);
  const fixes = {
    length: '35~100자, 1~2문장으로 쓰세요.',
    artifact: '따옴표·괄호·URL·해설 없이 댓글 본문만 쓰세요.',
    noise: '같은 기호나 ㅋㅋ를 반복하지 마세요.',
    unsupported_experience: '직접 가 보거나 써 본 것처럼 쓰지 마세요.',
    unsupported_reader_context: '"찾고 있었는데", "궁금했는데"처럼 내 사정을 지어내지 마세요.',
    unsupported_hearsay: '"~라고 들었는데" 같은 소문을 쓰지 마세요.',
    irrelevant: `글에 실제로 나온 대상(${keywords.join(', ') || '글의 핵심 단어'})을 하나 넣으세요.`,
    duplicate: '최근 댓글과 너무 비슷합니다. 문장 구조를 완전히 바꾸세요.'
  };
  const reasons = base.reasons.map((code) => reason(code, fixes[code] || code));
  const profile = styleProfile(recent);
  if (STOCK_COMMENT.test(clean)) reasons.push(reason('stock', '"좋은 정보", "잘 보고 갑니다", "큰 도움이 됐어요" 같은 아무 글에나 쓰는 말을 빼세요.'));
  if ((clean.match(EMOJI) || []).length > 1) reasons.push(reason('emoji_count', '이모지는 0~1개만 쓰세요.'));
  if (profile.emojiHeavy && TRAILING_EMOJI.test(clean)) reasons.push(reason('emoji_habit', '최근 댓글이 모두 이모지로 끝났습니다. 이번에는 이모지 없이 쓰세요.'));
  const opening = firstWord(clean);
  if (opening && profile.openings.has(opening)) reasons.push(reason('same_opening', `"${opening}"로 시작하는 댓글을 최근에 썼습니다. 첫 단어를 바꾸세요.`));
  for (const [name, re] of ENDING_FAMILIES) {
    if (profile.endings.includes(name) && re.test(clean)) reasons.push(reason('same_ending', `"${name}"로 끝나는 댓글이 최근에 많았습니다. 끝맺음을 바꾸세요.`));
  }
  for (const [name, re] of BUDGET_WORDS) {
    if (profile.words.includes(name) && re.test(clean)) reasons.push(reason('overused_word', `"${name.trim()}"를 최근 댓글에 너무 자주 썼습니다. 빼고 쓰세요.`));
  }
  return { ok: reasons.length === 0, text: clean, reasons, action: 'comment' };
}

/** What kind of comment I received, so the reply answers the right thing. */
export function classifyComment(text) {
  const clean = normalizeCommentText(text);
  if (/\?|어떻게|어디서|어디에|언제|얼마|되나요|있나요|인가요|할까요|건가요/.test(clean)) return 'question';
  if (/(?:받고|쓰고|써보고|사용하고|공유받고|알고) 싶|부탁|주세요|주실 수|가능할까|가능한가|문의/.test(clean)) return 'request';
  const words = stems(clean).filter((word) => !COMMON_WORDS.has(word) && !GREETING_WORD.test(word) && !SMALL_TALK.test(word));
  if ((words.length === 0 && clean.length < 120) || (words.length <= 1 && clean.length < 40)) return 'greeting';
  return 'remark';
}

const REPLY_TYPE_GUIDE = {
  greeting: '상대는 인사만 남겼습니다. 인사에 1문장으로 짧고 따뜻하게 화답하세요. 내 글 내용이나 "~하신 분들 많죠" 같은 일반론을 억지로 끼워 넣지 말고, 상대가 하지 않은 말을 했다고 쓰지 말고, 질문으로 끝내지 마세요.',
  question: '상대가 질문했습니다. 내 글에 있는 내용으로 그 질문에 먼저 답하세요. 글에 없는 내용이면 지어내지 말고 "그 부분은 글에 따로 정리해 볼게요"처럼 솔직하게 답하세요.',
  request: '상대가 무언가를 요청했습니다. 그 요청을 알아들었다는 것을 구체적으로 답하세요. 글에 없는 일정·가격·제공 약속은 하지 마세요.',
  remark: '상대가 자기 생각이나 경험을 말했습니다. 상대가 쓴 구체적인 말 하나를 받아서 이어가세요.'
};

/** Hints for the reply prompt: the comment type and the habits the recent replies already overused. */
export function replyGuidance(commentText, recentReplies = []) {
  const hints = [REPLY_TYPE_GUIDE[classifyComment(commentText)]];
  const profile = styleProfile(recentReplies);
  if (profile.endings.length) hints.push(`최근 대댓글이 ${profile.endings.map((name) => `"${name}"`).join(', ')}(으)로 자주 끝났습니다. 다른 말로 끝내세요.`);
  if (profile.words.length) hints.push(`${profile.words.map((name) => `"${name.trim()}"`).join(', ')}은(는) 쓰지 마세요.`);
  return hints;
}

/** Every rule a reply on my own post must pass. */
export function checkReply(text, { commentText = '', postTitle = '', postSnippet = '' } = {}, recentReplies = []) {
  const clean = normalizeCommentText(text);
  const reasons = [];
  if (clean.length < 10 || clean.length > 150) reasons.push(reason('length', '1~2문장, 10~150자로 쓰세요.'));
  if (/https?:\/\/|www\.|[#<>\[\]{}]/i.test(clean)) reasons.push(reason('artifact', 'URL·해시태그·괄호 없이 답글만 쓰세요.'));
  if ((clean.match(EMOJI) || []).length > 1) reasons.push(reason('emoji_count', '이모지는 0~1개만 쓰세요.'));
  if (META.test(clean)) reasons.push(reason('meta', '설명이나 해설 말고 상대에게 건네는 답글만 쓰세요.'));
  if (STOCK_REPLY.test(clean)) reasons.push(reason('stock', '"도움이 되셨다니", "궁금한 점 있으시면 언제든" 같은 상투적인 문장을 빼세요.'));
  if (READER_VOICE.test(clean)) reasons.push(reason('reader_voice', '당신은 이 글을 쓴 사람입니다. "정리해 주셔서", "좋은 글 감사" 같은 독자 말투를 쓰지 마세요.'));
  if (UNSOLICITED_ADVICE.test(clean)) reasons.push(reason('unsolicited_advice', '상대가 묻지 않은 충고나 훈계("~하지 않는 게 중요해요")를 하지 마세요.'));
  const similar = recentReplies.find((reply) => commentSimilarity(clean, reply) >= 0.6);
  if (similar) {
    const exact = commentSimilarity(clean, similar) >= 0.7;
    reasons.push(reason(!exact && classifyComment(commentText) === 'greeting' ? 'similar_greeting' : 'duplicate', '최근 대댓글과 너무 비슷합니다. 문장 구조를 바꾸세요.'));
  }

  // Nothing in the reply may be made up: its nouns must come from the comment or my post.
  const source = normalizeCommentText(`${commentText} ${postTitle} ${postSnippet}`).replace(/\s/g, '');
  const grounded = (word) => COMMON_WORDS.has(word) || source.includes(word) || (word.length >= 3 && source.includes(word.slice(0, 2)));
  const nouns = (normalizeCommentText(clean).match(/[가-힣A-Za-z0-9]{2,}(?:에서|으로|에게|은|는|이|가|을|를|에|의|로|와|과)(?=\s|$|[,.!?])/g) || [])
    .map((word) => word.replace(JOSA, '')).filter((word) => word.length >= 2);
  const missing = [...new Set(nouns.filter((word) => !grounded(word)))];
  if (missing.length >= 2) reasons.push(reason('ungrounded', `댓글과 내 글에 없는 내용(${missing.slice(0, 3).join(', ')})을 지어냈습니다. 댓글이나 내 글에 있는 내용으로만 쓰세요.`));

  // "…하신다는 말씀", "…셨다니": the commenter must really have said it.
  const comment = normalizeCommentText(commentText).replace(/\s/g, '');
  for (const match of clean.matchAll(ATTRIBUTION)) {
    const claim = stems(match[1] || match[2] || '').filter((word) => !CLAIM_STOP.has(word));
    if (claim.length && !claim.some((word) => comment.includes(word) || comment.includes(word.slice(0, 2)))) {
      reasons.push(reason('misattribution', `상대가 하지 않은 말("${(match[1] || match[2]).trim()}")을 했다고 썼습니다. 댓글에 실제로 있는 말에만 답하세요.`));
      break;
    }
  }

  // The reply must answer this comment: pick up something the commenter said, or answer a greeting with
  // a greeting. 2026-10-17: "포스팅 잘 보고 갑니다~ 좋은 가을 날씨네요. 행복한 주말보내세요" got
  // "저도 하루 제한 걸린 걸 직접 겪어보니 이 부분이 정말 중요하더라고요." (about my post, not the comment).
  const type = classifyComment(commentText);
  const said = stems(commentText).filter((word) => !CLAIM_STOP.has(word));
  const picksUp = stems(clean).filter((word) => !CLAIM_STOP.has(word))
    .some((word) => comment.includes(word.slice(0, 2)) || said.some((other) => other.slice(0, 2) === word.slice(0, 2)));
  if (comment && !picksUp && !(type === 'greeting' && GREETING_REPLY.test(clean))) {
    reasons.push(reason('unresponsive', `상대 댓글("${normalizeCommentText(commentText).slice(0, 30)}")에 답하세요. 상대가 쓴 말을 받아서 답하고, 상대가 꺼내지 않은 이야기로 바꾸지 마세요.`));
  }
  if (type === 'greeting') {
    // Nouns of my post the commenter never mentioned ("하루 제한", "AI 툴로 썸네일"); not describing words ("가득한").
    const postText = normalizeCommentText(`${postTitle} ${postSnippet}`).replace(/\s/g, '');
    const offTopic = stems(clean).filter((word) => !COMMON_WORDS.has(word) && !GREETING_WORD.test(word) && !SMALL_TALK.test(word)
      && !(word.length >= 3 && /(?:한|하게|하고|해서|하는|스러운|로운|운|던|었|았|겠)$/.test(word))
      && !comment.includes(word.slice(0, 2)) && postText.includes(word.length >= 4 ? word.slice(0, 3) : word));
    if (offTopic.length || /저도 .{0,20}(?:겪어|해 ?보니|써 ?보니|직접)/.test(clean)) {
      reasons.push(reason('post_on_greeting', `상대는 인사만 했습니다. 내 글 내용(${offTopic.slice(0, 2).join(', ') || '내 경험'})을 꺼내지 말고 인사에 인사로 답하세요.`));
    }
  }
  if ((type === 'question' || type === 'request')) {
    const asked = stems(commentText).filter((word) => !COMMON_WORDS.has(word));
    const answered = asked.some((word) => clean.includes(word) || clean.includes(word.slice(0, 2)));
    if (asked.length && !answered) reasons.push(reason('ignored_request', `댓글의 ${type === 'question' ? '질문' : '요청'}("${normalizeCommentText(commentText).slice(0, 30)}")에 먼저 답하세요.`));
  }
  if (type === 'greeting' && /\?[\s\p{Extended_Pictographic}]*$/u.test(clean)) reasons.push(reason('question_on_greeting', '인사만 한 사람에게 질문으로 끝내지 마세요.'));
  if (PRESUMPTION.test(clean) && !/관심|좋아|궁금/.test(commentText)) reasons.push(reason('presumption', '인사만 한 사람의 관심이나 마음을 넘겨짚지 마세요("관심이 많으신 것 같네요"). 인사에 화답하세요.'));

  const profile = styleProfile(recentReplies);
  for (const [name, re] of ENDING_FAMILIES) {
    if (profile.endings.includes(name) && re.test(clean)) reasons.push(reason('same_ending', `"${name}" 표현을 최근 대댓글에 많이 썼습니다. 다른 말로 쓰세요.`));
  }
  return { ok: reasons.length === 0, text: clean, reasons };
}

/** The retry instruction: what the last answer was and exactly what to fix. */
export function feedbackMessage(previous, reasons) {
  return `[방금 쓴 답은 검사에서 거절됐습니다]\n«${normalizeCommentText(previous)}»\n고칠 점:\n${reasons.map((item) => `- ${item.fix}`).join('\n')}\n위 문제를 모두 고쳐서 완전히 새로 쓰세요. 본문만 출력합니다.`;
}

/**
 * Write → check → rewrite with the reasons, up to MAX_ATTEMPTS. Returns the first answer that passes,
 * or '' with every attempt and its reasons (the caller skips instead of posting a bad comment).
 */
export async function runHarness({ messages, complete, check, temperatures = [0.7, 0.85, 1.0], onReject = () => {} }) {
  const attempts = [];
  let turn = messages;
  for (let index = 0; index < Math.min(MAX_ATTEMPTS, temperatures.length); index += 1) {
    const raw = String(await complete(turn, { temperature: temperatures[index] }) || '').trim();
    if (!raw) { attempts.push({ text: '', reasons: [reason('empty', '빈 응답')] }); continue; }
    const result = check(raw);
    // The last try may break a style rule (an ending or word used a lot lately), never a content rule.
    const lastTry = index === Math.min(MAX_ATTEMPTS, temperatures.length) - 1;
    if (!result.ok && lastTry && result.reasons.length && result.reasons.every((item) => SOFT_CODES.has(item.code))) {
      return { text: result.text, skipped: false, attempts, relaxed: result.reasons.map((item) => item.code) };
    }
    if (result.ok) return { text: result.action === 'skip' ? '' : result.text, skipped: result.action === 'skip', attempts };
    attempts.push({ text: result.text, reasons: result.reasons });
    onReject(result.text, result.reasons, index + 1);
    turn = [...messages, { role: 'assistant', content: result.text }, { role: 'user', content: feedbackMessage(result.text, result.reasons) }];
  }
  return { text: '', skipped: false, attempts };
}
