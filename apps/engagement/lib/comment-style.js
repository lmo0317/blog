import { commentSimilarity, COMMENT_DUPLICATE_THRESHOLD, normalizeCommentText } from './comment-prompt.js';

// How a comment is written: AI only, AI mixed with the user's own phrases, or phrases only.
export const COMMENT_MODES = Object.freeze(['ai', 'mixed', 'phrases']);
export const MAX_COMMENT_PHRASES = 50;
const MIXED_PHRASE_RATIO = 0.3;

export function normalizeCommentMode(mode) {
  return COMMENT_MODES.includes(mode) ? mode : 'ai';
}

export function normalizeCommentPhrases(input) {
  const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  const seen = new Set();
  const phrases = [];
  for (const line of lines) {
    const text = normalizeCommentText(line);
    if (text.length < 5 || text.length > 150 || seen.has(text) || /https?:\/\/|www\./i.test(text)) continue;
    seen.add(text);
    phrases.push(text);
    if (phrases.length >= MAX_COMMENT_PHRASES) break;
  }
  return phrases;
}

function fillPhrase(phrase, bloggerName) {
  const name = String(bloggerName || '').trim();
  return phrase
    .replace(/\{(?:닉네임|nickname|name)\}/gi, name ? `${name}` : '')
    .replace(/\s+/g, ' ')
    .replace(/^님[,\s]*/, '')
    .trim();
}

// A phrase that does not repeat the recent comments, or '' when every phrase was just used.
export function pickCommentPhrase(phrases, { recentComments = [], bloggerName = '', random = Math.random } = {}) {
  const fresh = phrases.filter((phrase) => !recentComments.slice(0, 10)
    .some((previous) => commentSimilarity(fillPhrase(phrase, bloggerName), previous) >= COMMENT_DUPLICATE_THRESHOLD));
  if (!fresh.length) return '';
  return fillPhrase(fresh[Math.floor(random() * fresh.length)], bloggerName);
}

export async function composeComment({ mode = 'ai', phrases = [], recentComments = [], bloggerName = '', generateAi, random = Math.random }) {
  const cleanMode = normalizeCommentMode(mode);
  const phrase = () => pickCommentPhrase(phrases, { recentComments, bloggerName, random });
  if (cleanMode === 'phrases' || (cleanMode === 'mixed' && phrases.length && random() < MIXED_PHRASE_RATIO)) {
    const text = phrase();
    if (text || cleanMode === 'phrases') return { text, source: 'phrase' };
  }
  const aiText = await generateAi();
  if (aiText) return { text: aiText, source: 'ai' };
  if (cleanMode === 'mixed') {
    const text = phrase();
    if (text) return { text, source: 'phrase' };
  }
  return { text: '', source: 'ai' };
}

// The blogger turned comments off (or closed the box): nothing went wrong, the post is just skipped for
// comments. Logged as a skip, not an error, so the customer's error count shows real problems only.
export function isCommentClosedByAuthor(reason = '') {
  return /댓글 비허용|댓글창 닫힘|작성 권한 없음/.test(String(reason));
}

// A comment left out on purpose (comments closed, a sensitive post, the AI judged it better to skip): a skip, not an error.
export function isDeliberateCommentSkip(reason = '') {
  return isCommentClosedByAuthor(reason) || /민감한 주제|댓글을 달지 않는 게 낫다|공감만 했습니다/.test(String(reason));
}

// Default comments for when the AI cannot write one that passes the checks (or answers SKIP). They say nothing
// about the post, so they cannot misread it, invent a life, or mistake the blogger for someone in the news; they
// are only used for posts that passed the sensitive-topic gate and after the model actually answered.
// Nothing that assumes I am a regular reader or that the post is new: search finds months-old posts on blogs I
// have never visited (2026-10-20 audit: "새 글 반가운 마음으로" on a July post, "오늘도 들러서" on a first visit).
export const DEFAULT_COMMENTS = Object.freeze([
  '글 차분하게 잘 읽었어요. 오늘도 편안한 하루 보내세요!',
  '정성이 느껴지는 글이라 끝까지 읽게 되네요. 좋은 하루 되세요 :)',
  '읽는 내내 편안했어요. 남은 하루도 즐겁게 보내세요.',
  '시간 내서 쓰신 글 잘 읽었습니다. 기분 좋은 하루 보내세요 😊',
  '천천히 읽어 보니 좋네요. 따뜻한 하루 보내세요.',
  '정리된 글이라 읽기 편했어요. 이번 주도 힘내세요!',
  '쉬어 가는 마음으로 읽고 가요. 오늘도 수고 많으셨어요.',
  '글 잘 읽었습니다. 편안한 시간 보내세요.',
  '글에서 따뜻함이 느껴져요. 행복한 하루 보내세요!',
  '끝까지 재미있게 읽었어요. 다음 글도 기다릴게요 :)'
]);

// Replies to comments on my own posts, by what the visitor wrote. Questions and requests never get one.
export const DEFAULT_REPLIES = Object.freeze({
  greeting: [
    '들러 주셔서 고마워요. 남은 하루도 편안하게 보내세요!',
    '찾아와 주셔서 감사해요. 오늘도 기분 좋은 일 가득하시길 바라요.',
    '댓글 남겨 주셔서 힘이 나요. 행복한 하루 되세요 :)',
    '와 주셔서 반가워요. 좋은 하루 보내시고 또 놀러 오세요!',
    '읽어 주셔서 고맙습니다. 따뜻한 하루 보내세요.',
    '인사 남겨 주셔서 감사해요. 이번 주도 힘내세요!'
  ],
  visit: [
    '찾아와 주셔서 고마워요. 시간 날 때 꼭 들를게요, 편안한 하루 보내세요!',
    '인사 남겨 주셔서 감사해요. 저도 곧 놀러 갈게요. 좋은 하루 되세요!',
    '댓글 고마워요. 블로그에도 꼭 들를게요, 행복한 하루 보내세요 :)'
  ],
  remark: [
    // Any remark, praise or a complaint ("가격은 아쉽지만"): a thank-you that agrees with neither.
    '꼼꼼히 읽어 주셔서 고마워요. 남은 하루도 편안하게 보내세요.',
    '이야기 나눠 주셔서 감사해요. 편안한 하루 보내세요.',
    '정성스러운 댓글 고마워요. 오늘도 좋은 하루 되세요 :)'
  ]
});

const VISIT_REQUEST = /답방(?: ?(?:왔|와|옵|갑|가요|갈게|드려|드립|부탁|환영|해 ?주|오세요|합니|해요|요(?![가-힣])|[!~.^]|$))|놀러 ?와|놀러 ?오|와 ?주시면|와 ?주실|방문(?:해)? ?주|들러 ?주/;

function pickFresh(pool, recent, random) {
  const fresh = pool.filter((line) => !recent.slice(0, 20).some((previous) => commentSimilarity(line, previous) >= 0.6));
  const choices = fresh.length ? fresh : pool;
  return choices[Math.floor(random() * choices.length)];
}

/** A default comment unlike the recent ones. */
export function pickDefaultComment(recentComments = [], { random = Math.random } = {}) {
  return pickFresh(DEFAULT_COMMENTS, recentComments, random);
}

/** A default reply for this visitor comment, or '' when it needs a real answer (a question or a request). */
// The thing the visitor talked about, when my title names it too ("육회포케", "블로그 댓글"): a default reply that
// names it reads as an answer, a bare "댓글 고마워요" under "육회에 메밀면 조합이 색다르네요" does not (2026-10-20 eval).
const TOPIC_STOP = /^(?:정말|너무|진짜|완전|포스팅|정보|오늘|하루|감사|좋은|글|블로그|이웃|맛집|후기|추천|정리|내용|덕분|우와|와우|요즘|댓글|공감|구독)$/;
export function commentTopic(commentText = '', postTitle = '') {
  const comment = String(commentText || '').replace(/\s/g, '').toLowerCase();
  // Nouns of my title ("포케", "슬로우캘리", "꽃게"), not its describing words ("맛있는", "다양하고"), that the visitor
  // also wrote, even inside a longer word ("육회포케에" has 포케).
  const nouns = (String(postTitle || '').match(/[가-힣A-Za-z0-9]{2,}/g) || [])
    .filter((word) => !/(?:하고|하는|있는|없는|한|운|는|은|히|고|던|된|할|러|서)$/.test(word))
    .map((word) => word.replace(/(?:에서|으로|에는|까지|이랑|은|는|이|가|을|를|에|의|로|와|과|도|만|랑|집|점)$/, (josa, i) => (josa === '집' || josa === '점') && word.length <= 3 ? josa : ''))
    .filter((word) => word.length >= 2 && !TOPIC_STOP.test(word) && comment.includes(word.toLowerCase()));
  return nouns.sort((a, b) => b.length - a.length)[0] || '';
}

const COMPLAINT = /아쉽|아쉬웠|별로|비싸|실망|불친절|불편|짜더|싱겁/;
// Praise of my post, not advice in it ("샴푸 한번 사용해보면 좋을 것 같아요" is a tip: 2026-10-20 eval).
const PRAISE_WORDS = /맛있|맛나|좋네|좋아요|좋다|좋았|좋은|예쁘|이쁘|깔끔|멋지|멋있|대박|최고|훌륭|유용|유익|든든|푸짐|신기|색다르/;
const PRAISE = { test: (text) => PRAISE_WORDS.test(text) && !/좋을 ?것 ?같|좋겠|(?:해|써|사용해) ?보면|하면 좋/.test(text) };

export function pickDefaultReply(type, commentText = '', recentReplies = [], { random = Math.random, postTitle = '' } = {}) {
  if (type === 'question' || type === 'request') return '';
  if (type === 'remark' && COMPLAINT.test(commentText)) {
    return pickFresh(['솔직한 이야기 남겨 주셔서 고마워요. 편안한 하루 보내세요.', '솔직하게 말씀해 주셔서 감사해요. 좋은 하루 되세요.'], recentReplies, random);
  }
  // "정리가 쉽지않아요 ㅋㅋ": they share a struggle; "꼼꼼히 읽어 주셔서" ignores it (eval v11).
  if (type === 'remark' && /쉽지 ?않|어렵(?:더|네|다|어|고)|힘들(?:어|었|다|네|더|고)|막막|번거롭|귀찮/.test(commentText) && !PRAISE.test(commentText)) {
    return pickFresh(['맞아요, 쉽지 않죠. 공감해 주셔서 고마워요. 편안한 하루 보내세요.', '저도 그 마음 알아요. 이야기 나눠 주셔서 감사해요, 좋은 하루 되세요.'], recentReplies, random);
  }
  const topic = type === 'remark' && !VISIT_REQUEST.test(commentText) ? commentTopic(commentText, postTitle) : '';
  if (topic) {
    const lines = PRAISE.test(commentText)
      ? [`${topic} 좋게 봐 주셔서 고마워요. 편안한 하루 보내세요!`, `${topic} 예쁘게 봐 주셔서 감사해요. 남은 하루도 즐겁게 보내세요.`, `${topic} 마음에 들어 하셔서 저도 기뻐요. 좋은 하루 되세요 :)`]
      : [`${topic} 이야기 나눠 주셔서 고마워요. 좋은 하루 보내세요!`, `${topic} 이야기에 댓글 남겨 주셔서 감사해요. 편안한 하루 되세요.`];
    return pickFresh(lines, recentReplies, random);
  }
  // A compliment without a word from my title ("너무 맛있을 것 같아요!", "깔끔하네요"): thank them for it.
  if (type === 'remark' && PRAISE.test(commentText)) {
    const lines = /맛있|맛나|맛있겠|든든|푸짐/.test(commentText)
      ? ['맛있게 봐 주셔서 고마워요. 편안한 하루 보내세요!', '맛있게 봐 주셔서 저도 기분 좋네요. 좋은 하루 되세요 :)', '맛있게 봐 주셔서 감사해요. 남은 하루도 즐겁게 보내세요.']
      : ['좋게 봐 주셔서 고마워요. 편안한 하루 보내세요!', '예쁘게 봐 주셔서 감사해요. 남은 하루도 즐겁게 보내세요.', '좋은 말씀 남겨 주셔서 고마워요. 좋은 하루 되세요 :)'];
    return pickFresh(lines, recentReplies, random);
  }
  const pool = VISIT_REQUEST.test(commentText) ? DEFAULT_REPLIES.visit : DEFAULT_REPLIES[type] || DEFAULT_REPLIES.remark;
  return pickFresh(pool, recentReplies, random);
}
