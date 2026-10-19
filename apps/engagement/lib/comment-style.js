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
  return isCommentClosedByAuthor(reason) || /민감한 주제|댓글을 달지 않는 게 낫다/.test(String(reason));
}

// Default comments for when the AI cannot write one that passes the checks (or answers SKIP). They say nothing
// about the post, so they cannot misread it, invent a life, or mistake the blogger for someone in the news; they
// are only used for posts that passed the sensitive-topic gate and after the model actually answered.
export const DEFAULT_COMMENTS = Object.freeze([
  '글 차분하게 잘 읽었어요. 오늘도 편안한 하루 보내세요!',
  '정성이 느껴지는 글이라 끝까지 읽게 되네요. 좋은 하루 되세요 :)',
  '읽는 내내 편안했어요. 남은 하루도 즐겁게 보내세요.',
  '오늘도 들러서 잘 읽고 갑니다. 기분 좋은 하루 보내세요 😊',
  '천천히 읽어 보니 좋네요. 따뜻한 하루 보내세요.',
  '꾸준히 글 올려 주셔서 자주 들르게 되네요. 이번 주도 힘내세요!',
  '쉬어 가는 마음으로 읽고 가요. 오늘도 수고 많으셨어요.',
  '새 글 반가운 마음으로 읽었어요. 편안한 저녁 되세요.',
  '글에서 따뜻함이 느껴져요. 행복한 하루 보내세요!',
  '오늘 글도 잘 보고 갑니다. 다음 글도 기다릴게요 :)'
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
    '좋게 봐 주셔서 감사해요. 앞으로도 편하게 들러 주세요!',
    '꼼꼼히 읽어 주셔서 고마워요. 남은 하루도 편안하게 보내세요.',
    '이야기 남겨 주셔서 감사해요. 덕분에 힘이 나네요 :)'
  ]
});

const VISIT_REQUEST = /답방|놀러 ?와|놀러 ?오|와 ?주시면|와 ?주실|방문(?:해)? ?주|들러 ?주/;

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
export function pickDefaultReply(type, commentText = '', recentReplies = [], { random = Math.random } = {}) {
  if (type === 'question' || type === 'request') return '';
  const pool = VISIT_REQUEST.test(commentText) ? DEFAULT_REPLIES.visit : DEFAULT_REPLIES[type] || DEFAULT_REPLIES.remark;
  return pickFresh(pool, recentReplies, random);
}
