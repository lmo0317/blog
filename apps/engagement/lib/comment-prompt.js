export const COMMENT_PROMPT_VERSION = 'comment-system-v3';
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
    .replace(/\s+/g, ' ')
    .trim()
    // Only quotes wrapping the whole answer are the model's; "'학교 2013'이라는 …" used to lose its opening quote.
    .replace(/^(["“”'‘’「『])([\s\S]*)(["“”'‘’」』])$/, (whole, open, inner) => (/["“”'‘’「」『』]/.test(inner) ? whole : inner))
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
  if (/[<>\[\]{}$\\]|https?:\/\/|www\.|```|\b(?:system|assistant|user)\b/i.test(raw)) reasons.push('artifact');
  if (/([!?.ㅋㅎㅠㅜ])\1{3,}/.test(text)) reasons.push('noise');
  if (/(?:제가|저도).*?(?:가봤|다녀왔|먹어봤|써봤|구매했|사용해봤)/.test(text) && !/(?:다녀왔|방문했|먹어봤|구매했|사용했)/.test(String(context.contentSnippet || ''))) reasons.push('unsupported_experience');
  if (/(?:제가|저는|저도).*?(?:찾고 있었|고민하고 있었|궁금했|필요했|사려고 했|구매하려 했|가려고 했|해보려고 했)|(?:찾고|고민하고?) 있었는데|고민이었는데|궁금했는데|궁금했어요|궁금하던 참|고민했는데|찾던 중|(?:써|사용해|먹어|가|다녀)보니|(?:좋|편하|유용하)더라고요/.test(text)) reasons.push('unsupported_reader_context');
  if (/(?:유명|좋|맛있|괜찮|효과적).*?(?:다고|라고) 들었/.test(text)) reasons.push('unsupported_hearsay');
  // 2026-10-19 audit: "저희 아이도", "우리 아이가", "저도 예전에 먹어봤는데", "저도 청첩장 준비", "저도 혈당 걱정",
  // "저도 트립닷컴에서 좋은 딜을 찾았어요": a life the commenter does not have.
  const INVENTED_LIFE = /(?:저희|우리) (?:아이|애|딸|아들|남편|아내|와이프|신랑|부모님|엄마|아빠|강아지|고양이|회사|학교)|저도 (?:예전에|어릴 때|한때|요즘|최근에|지금|비슷한|같은)|저도 .{0,20}(?:준비|걱정|고민|경험|찾았|샀|먹었|봤는데|갔었|다녔|키우)|직접 (?:보니|가 ?보니|먹어 ?보니|해 ?보니)|저도 (?:가끔|평소|회사|퇴근|출근|생생|아이|아기)|기억이 저도|(?:아이|아기|애들|가족)(?:와|랑|하고) (?:함께|같이)?|(?:아기|아이)랑 |(?:학부모|수험생|엄마|아빠|직장인|부모|취준생) 입장|막막했던|막연했던|진로 (?:계획|고민)|(?:보내고|다녀|놀다) 올게요/g;
  const postText = normalizeCommentText(`${context.title || ''} ${context.contentSnippet || ''}`);
  // A phrase the post itself uses ("아이와 함께" in a family outing post) is about the post, not a made-up life.
  if ([...text.matchAll(INVENTED_LIFE)].some((m) => !postText.includes(m[0].trim()))) reasons.push('unsupported_experience');
  // News, entertainment and sports write-ups: the blogger only passed the story on. 2026-10-19 audit: "수술까지 받으시면서도
  // 근황을 나눠주셔서", "100kg 넘게 드셨다는", "맘보걸로 안방극장을 사로잡으셨던" were said to bloggers about the people in the news.
  // A post about someone else: news wording, a role before a name ("배우 한고은이"), a company as subject, or report-style
  // "~했다." sentences. The commenter must then talk about them in the third person, never "~하셨다니" to the blogger.
  const newsLike = /기자|보도했|보도에 따르면|밝혔다|전했다|라고 말했다|에 따르면|소속사|관계자는|관계자에 따르면|매체|단독|연합뉴스|뉴스1|뉴시스|OSEN|스포츠조선|일간스포츠|방송에서|출연해|입대|별세|선고/.test(postText)
    || /(?:배우|가수|개그우먼|개그맨|방송인|선수|감독|아이돌|모델|유튜버|대표|회장|대통령|장관|의원) [가-힣]{2,4}(?:이|가|은|는|의|씨)\s/.test(postText)
    || /(?:기업|회사|업체|법인)(?:은|는|이|가)\s/.test(postText)
    || (postText.match(/[가-힣](?:했|됐|었|았|였|받았|났)다[.\s]/g) || []).length >= 3;
  if (newsLike && /(?:셨|으셨|하셨)(?:다니|다는|던|군요|네요|어요|잖아요|을|겠)|(?:주셔서|주시니|주신 |해 ?주셔)|근황을|돌아오신|돌아오실|보여주신|받으시면서|계신 점|오신 모습|드신 /.test(text)) reasons.push('news_as_person');
  const keywords = contentKeywords(context);
  if (keywords.length && !keywords.slice(0, 30).some((word) => text.toLowerCase().includes(word.toLowerCase()))) reasons.push('irrelevant');
  if (recentComments.some((previous) => commentSimilarity(text, previous) >= COMMENT_DUPLICATE_THRESHOLD)) reasons.push('duplicate');
  return { ok: reasons.length === 0, text, reasons, keywords, action: 'comment' };
}

export function buildBlogCommentMessages({ title = '', contentSnippet = '', imageSummary = '', tone = 'friendly', recentComments = [], guidance = [] } = {}) {
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
4. 따뜻한 한국어 1~2문장, 35~100자로 씁니다. 이모지는 0~1개입니다.
5. 홍보, URL, 자기소개, 이웃 신청, 답변 해설을 쓰지 않습니다.
6. "좋은 정보", "잘 보고 갑니다", "큰 도움이 됐어요", "정말 중요할 것 같아요"처럼 아무 글에나 붙는 말은 쓰지 않습니다.
7. "궁금했는데", "찾고 있었는데"처럼 내 사정을 지어내지 않습니다.
8. 글쓴이와 글 속 인물을 구분합니다. 뉴스·연예·스포츠·정보 정리 글이면 글쓴이는 소식을 전한 사람일 뿐입니다. 글쓴이를 기사 속 당사자(연예인, 피해자, 수술받은 사람, 선수, 업체, 고객)로 대하지 말고 "~하셨다니", "근황을 나눠 주셔서", "회복하시는 모습" 같은 말을 쓰지 않습니다. 소식 내용에 대한 생각을 말합니다.
9. 댓글 쓰는 사람에게는 아이·배우자·부모·반려동물·직장·학교가 없다고 생각합니다. "우리 아이", "저희 아이도", "저도 예전에", "저도 준비 중", "저도 걱정" 같은 내 사정을 만들지 않습니다.
10. 이미 끝난 일(다녀온 후기, 지난 행사, 이룬 결과)을 앞으로의 일처럼 말하지 않습니다.
11. 내용이 부족하거나, 사건·사고·질병·이별처럼 무거운 글이거나, 안전하게 맞춤 댓글을 쓸 수 없으면 SKIP만 출력합니다.

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
${tones[tone] || tones.friendly}${guidance.length ? `

[이번 댓글 작성 지침]
${guidance.map((hint) => `- ${hint}`).join('\n')}` : ''}`;
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

// Posts where any cheerful stranger's comment reads as careless: a death, a crime or trial, an accident,
// someone's illness, self-harm, or a clinic advertising a procedure (a comment there vouches for the result).
// 2026-10-19 audit: "법원의 판단이 그렇게 무거울 줄은 몰랐어요 🙏" on a JMS sentencing post, "결과가 눈에 보여서
// 보기 좋네요" on a 지방분해주사 ad. These get a like at most, never an AI comment.
const SENSITIVE_TOPICS = [
  ['부고·추모', /별세|부고|타계|영면|명복|조문|빈소|발인|추모식|장례|돌아가셨|세상을 떠|숨졌|숨진|사망했|사망한/],
  ['사건·재판', /성범죄|성폭행|성추행|강간|살인|살해|폭행 사건|아동학대|학대 사건|징역|실형|구속 기소|기소됐|피해자|가해자|선고 공판|항소심|대법원 판결|형량/],
  ['사고·재난', /참사|사망자|희생자|실종자|추락 사고|교통사고로|화재로 .{0,6}(?:숨|사망|부상)|붕괴 사고/],
  ['투병', /투병|항암|암 진단|암 진행|암 수술|갑상선암|종양 (?:제거|수술)|시한부|중환자실|호스피스|희귀병/],
  ['극단적 선택', /자살|극단적 선택|자해/],
  ['시술 광고', /지방흡입|지방분해|지방 분해|보톡스|필러 시술|리프팅 시술|쁘띠 시술|성형외과|피부과 시술|모발이식|탈모 치료/]
];

/** Why a comment must not be written on this post, or '' when it may. The title alone decides; the body needs two hits. */
export function sensitivePostReason({ title = '', contentSnippet = '' } = {}) {
  const head = normalizeCommentText(title);
  const body = normalizeCommentText(contentSnippet).slice(0, 600);
  for (const [label, re] of SENSITIVE_TOPICS) {
    const inBody = (body.match(new RegExp(re.source, 'g')) || []).length;
    if (re.test(head) || inBody >= 2) return `민감한 주제(${label})의 글이라 댓글은 달지 않았습니다.`;
  }
  return '';
}
