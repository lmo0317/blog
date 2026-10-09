export const COMMENT_PROMPT_VERSION = 'comment-system-v1';
export const COMMENT_DUPLICATE_THRESHOLD = 0.72;

const COMMENT_STOPWORDS = new Set([
  '그리고', '하지만', '정말', '너무', '관련', '대한', '이번', '오늘', '포스팅', '블로그',
  '후기', '정보', '내용', '사진', '입니다', '있습니다', '했어요', '하는', '에서', '으로'
]);

export function normalizeCommentText(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff\ufffd]/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^(?:댓글|답변|assistant|comment)\s*[:：-]\s*/i, '')
    .replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function contentKeywords({ title = '', contentSnippet = '', imageSummary = '' } = {}) {
  return [...new Set(`${title} ${contentSnippet} ${imageSummary}`.normalize('NFC').match(/[가-힣A-Za-z0-9]{2,}/g) || [])]
    .filter((word) => !COMMENT_STOPWORDS.has(word) && !/^\d+$/.test(word))
    .sort((a, b) => b.length - a.length);
}

export function commentSimilarity(a, b) {
  const grams = (value) => {
    const clean = normalizeCommentText(value).replace(/\s/g, '');
    return new Set(Array.from({ length: Math.max(0, clean.length - 1) }, (_, index) => clean.slice(index, index + 2)));
  };
  const left = grams(a);
  const right = grams(b);
  if (!left.size || !right.size) return 0;
  return [...left].filter((gram) => right.has(gram)).length / Math.min(left.size, right.size);
}

export function validateBlogComment(comment, context = {}, recentComments = []) {
  const raw = String(comment || '');
  const text = normalizeCommentText(comment);
  const reasons = [];
  if (text === 'SKIP') return { ok: true, text, reasons, keywords: [], action: 'skip' };
  if (text.length < 15 || text.length > 120) reasons.push('length');
  if (/[<>\[\]{}]|https?:\/\/|www\.|```|\b(?:system|assistant|user)\b/i.test(raw)) reasons.push('artifact');
  if (/([!?.ㅋㅎㅠㅜ])\1{3,}/.test(text)) reasons.push('noise');
  if (/(?:제가|저도).*?(?:가봤|다녀왔|먹어봤|써봤|구매했|사용해봤)/.test(text) && !/(?:다녀왔|방문했|먹어봤|구매했|사용했)/.test(String(context.contentSnippet || ''))) reasons.push('unsupported_experience');
  if (/(?:제가|저는|저도).*?(?:찾고 있었|고민하고 있었|궁금했|필요했|사려고 했|구매하려 했|가려고 했|해보려고 했)|(?:찾고|고민하고?) 있었는데|고민이었는데|(?:써|사용해|먹어|가|다녀)보니|(?:좋|편하|유용하)더라고요/.test(text)) reasons.push('unsupported_reader_context');
  if (/(?:유명|좋|맛있|괜찮|효과적).*?(?:다고|라고) 들었/.test(text)) reasons.push('unsupported_hearsay');
  const keywords = contentKeywords(context);
  if (keywords.length && !keywords.slice(0, 30).some((word) => text.toLowerCase().includes(word.toLowerCase()))) reasons.push('irrelevant');
  if (recentComments.some((previous) => commentSimilarity(text, previous) >= COMMENT_DUPLICATE_THRESHOLD)) reasons.push('duplicate');
  return { ok: reasons.length === 0, text, reasons, keywords, action: 'comment' };
}

export function buildBlogCommentMessages({ title = '', contentSnippet = '', imageSummary = '', tone = 'friendly', recentComments = [] } = {}) {
  const tones = {
    friendly: '따뜻하고 친근한 해요체',
    polite: '정중하고 차분한 해요체',
    enthusiastic: '밝게 감탄하되 과장하지 않는 해요체'
  };
  const system = `당신은 네이버 블로그 글을 읽고 자연스러운 맞춤 댓글을 작성합니다.

규칙:
1. 제공된 글에 실제로 나온 구체적 대상이나 경험을 하나 이상 언급합니다.
2. 글에 없는 방문, 구매, 사용, 맛, 효과를 경험한 것처럼 지어내지 않습니다.
3. 최근 댓글의 문구와 문장 구조를 반복하지 않습니다.
4. 따뜻한 한국어 1~2문장, 35~100자로 씁니다. 이모지는 최대 1개입니다.
5. 홍보, URL, 자기소개, 이웃 신청, 답변 해설을 쓰지 않습니다.
6. 내용이 부족하거나 안전하게 맞춤 댓글을 쓸 수 없으면 SKIP만 출력합니다.

댓글 본문 또는 SKIP만 출력합니다.`;
  const user = `[제목]
${normalizeCommentText(title) || '없음'}

[본문 요약]
${normalizeCommentText(contentSnippet) || '없음'}

[이미지 설명]
${normalizeCommentText(imageSummary) || '없음'}

[최근 사용 댓글]
${recentComments.slice(0, 8).map((comment) => `- ${normalizeCommentText(comment)}`).join('\n') || '- 없음'}

[말투]
${tones[tone] || tones.friendly}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// Neighbor-request (서로이웃 신청) messages: short, personal, grounded in the post that was just read.
const NEIGHBOR_MESSAGE_BANNED = /(광고|협찬|체험단|홍보|수익|부업|재테크 비법|대출|보험|맞팔|선팔|이웃\s*늘리|방문\s*부탁|링크|카톡|오픈채팅)/;

export function validateNeighborMessage(message, context = {}) {
  const raw = String(message || '');
  const text = normalizeCommentText(message);
  const reasons = [];
  if (text.length < 15 || text.length > 100) reasons.push('length');
  if (/[<>\[\]{}#]|https?:\/\/|www\.|```|\b(?:system|assistant|user)\b/i.test(raw)) reasons.push('artifact');
  if (NEIGHBOR_MESSAGE_BANNED.test(text)) reasons.push('promotional');
  if (/(?:다녀왔|먹어봤|써봤|구매했|사용해봤)/.test(text)) reasons.push('unsupported_experience');
  const keywords = contentKeywords(context);
  if (keywords.length && !keywords.slice(0, 30).some((word) => text.toLowerCase().includes(word.toLowerCase()))) reasons.push('irrelevant');
  return { ok: reasons.length === 0, text, reasons };
}

export function buildNeighborMessagePrompt({ bloggerName = '', title = '', contentSnippet = '', baseMessage = '' } = {}) {
  const system = `당신은 네이버 블로거로서, 방금 읽은 글의 작성자에게 서로이웃 신청 메시지를 씁니다.

규칙:
1. 글에 실제로 나온 주제나 대상을 하나 언급해 진짜로 읽었음이 드러나게 합니다.
2. 정중한 해요체 1~2문장, 30~90자로 씁니다. 이모지는 최대 1개입니다.
3. 방문·구매·사용 경험을 지어내지 않습니다.
4. 홍보, 링크, 해시태그, 맞팔·선팔 같은 표현을 쓰지 않습니다.
5. 사용자가 적은 기본 인사말의 분위기를 따르되 문장은 새로 씁니다.

메시지 본문만 출력합니다.`;
  const user = `[상대 닉네임]
${normalizeCommentText(bloggerName) || '없음'}

[글 제목]
${normalizeCommentText(title) || '없음'}

[글 요약]
${normalizeCommentText(contentSnippet).slice(0, 400) || '없음'}

[기본 인사말]
${normalizeCommentText(baseMessage) || '안녕하세요! 좋은 이웃으로 소통하고 지내요.'}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}
