// A second look by the model at a comment the rule checks passed: questions about meaning that rules cannot see
// (a story the commenter never lived, the blogger taken for the person in the news, an ad told as one's own use,
// a comment about something the post does not say). Measured with eval/judge-eval.mjs before use.
import { normalizeCommentText } from './comment-prompt.js';

const QUESTIONS = [
  ['invented', '댓글 쓴 사람이 자기가 직접 가 보거나 먹어 보거나 써 본 것처럼 말하나요? (글을 읽고 "~겠어요", "~해 봐야겠어요"라고 하는 것은 아니오)'],
  ['wrong_person', '글은 연예인·선수·기업 등 다른 사람의 소식을 전하는데, 댓글이 그 당사자에게 직접 말하듯 축하·위로·칭찬하나요?'],
  ['not_in_post', '댓글이 글에 없는 내용이나 글과 다른 내용을 사실처럼 말하나요?']
];

export function buildJudgeMessages({ title = '', contentSnippet = '', comment = '' }) {
  const system = '당신은 블로그 댓글 검수자입니다. 글과 댓글을 읽고 질문마다 "예" 또는 "아니오"로만 답합니다. JSON만 출력합니다.';
  const user = [
    `[글 제목]\n${normalizeCommentText(title)}`,
    `[글 내용]\n${normalizeCommentText(contentSnippet).slice(0, 700)}`,
    `[댓글]\n${normalizeCommentText(comment)}`,
    `[질문]\n${QUESTIONS.map(([key, question]) => `${key}: ${question}`).join('\n')}`,
    `다음 형식으로만 답하세요: {${QUESTIONS.map(([key]) => `"${key}":"예|아니오"`).join(',')}}`
  ].join('\n\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// What to fix, fed back to the writer on the next try.
const FIXES = {
  invented: '직접 가 보거나 먹어 보거나 써 본 것처럼 쓰지 마세요. 글을 읽은 사람으로서 반응하세요.',
  wrong_person: '글쓴이는 소식을 전한 사람입니다. 기사 속 인물에게 축하·위로하듯 쓰지 말고 소식에 대한 반응을 쓰세요.',
  not_in_post: '글에 없는 내용이나 글과 다른 내용을 쓰지 마세요. 글에 실제로 있는 것만 말하세요.'
};

/** { ok, reason, reasons }: ok false when the model answers 예 to any question. An unreadable answer counts as ok. */
export async function judgeComment(context, complete) {
  const raw = String(await complete(buildJudgeMessages(context)) || '');
  let parsed = null;
  try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').match(/\{[\s\S]*\}/)?.[0] || ''); } catch {}
  if (!parsed) return { ok: true, reason: `판정 없음 (${raw.slice(0, 40)})`, reasons: [] };
  const flagged = QUESTIONS.map(([key]) => key).filter((key) => /^예|yes/i.test(String(parsed[key] || '').trim()));
  return { ok: flagged.length === 0, reason: flagged.join(',') || 'ok', reasons: flagged.map((key) => ({ code: `judge_${key}`, fix: FIXES[key] })) };
}
