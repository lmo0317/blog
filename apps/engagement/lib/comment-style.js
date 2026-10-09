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
