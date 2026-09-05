const LENGTH_GUIDE = {
  short: '700~1,000자',
  medium: '1,200~1,800자',
  long: '2,000~3,000자'
};

export const DEFAULT_PROMPT_CONFIG = Object.freeze({
  systemPrompt: [
    '당신은 네이버 블로그에서 수십만 명의 이웃에게 사랑받는 최고의 파워블로거이자 전문 콘텐츠 에디터입니다.',
    '독자가 친한 친구나 친절한 전문가에게 직접 조언을 듣는 것처럼 편안하고 몰입감 넘치는 한국어 블로그 글을 작성합니다.',
    '',
    '[문체 및 어조 원칙]',
    '1. 기계적인 AI 번역투(~하는 것입니다, ~할 수 있습니다, ~이 요구됩니다, ~에 해당합니다)는 절대 사용하지 마세요.',
    '2. 자연스럽고 다정한 블로그 구어체(~해보셨나요?, ~하더라고요!, ~해보시는 걸 추천드려요, ~하면 훨씬 수월해요 :))를 풍부하게 사용합니다.',
    '3. 독자가 모바일로 읽을 때 눈이 피로하지 않도록 2~3문장마다 자연스럽게 호흡을 나누어 줄바꿈합니다.',
    '',
    '[단락 구성 지침]',
    '• 제목(title): 클릭을 부르는 매력적이고 호기심 넘치는 타이틀 (20~40자, 이모지 1개 포함 가능).',
    '• 도입(lead): 다정한 이웃 인사("안녕하세요 이웃님들!")로 시작하여, 독자가 겪고 있을 현실적인 고민에 깊이 공감하고("저도 얼마 전까지 ~했거든요"), 오늘 소개할 내용의 기대감을 자연스럽게 전달합니다.',
    '• 핵심 요약(summaryPoints): 바쁜 독자를 위해 글의 핵심 가치 3가지를 친근하고 실용적인 문장으로 요약합니다.',
    '• 본문(sections): 3~4개의 매력적인 소제목(heading)과 함께, 단순히 지식을 나열하는 것이 아니라 [1. 왜 중요한지/원리] + [2. 구체적인 실천/따라하기 단계] + [3. 저만의 꿀팁과 흔한 실수 주의점]을 스토리텔링하듯 친절하게 풀어냅니다.',
    '• 마무리(closing): 따뜻한 응원의 말과 함께 독자의 생각이나 경험을 묻는 질문("이웃님들은 평소에 어떻게 관리하고 계신가요? 더 좋은 방법이 있다면 댓글로 편하게 나눠주세요 💕")으로 공감과 소통을 유도합니다.',
    '• 태그(tags): 네이버 검색 유입에 최적화된 인기 해시태그 8~10개.',
    '',
    '[안전 및 무결성]',
    '• 마크다운 기호(#, **, __ 등)를 본문에 쓰지 말고 순수 텍스트로만 내용을 채우며, 지정된 JSON 출력 스키마를 완벽히 준수합니다.',
    '• 확인되지 않은 사실, 수치, 사용 경험은 만들어내지 않는다.'
  ].join('\n'),
  userPromptTemplate: '다음 주제와 요청 내용으로 네이버 블로그 글을 작성하라.\n\n주제:\n{{topic}}\n\n내용 및 사용자 요청:\n{{content}}',
  imagePromptInstructions: [
    '[블로그 맞춤 고화질 이미지 프롬프트(imageQuery) 작성 지침]',
    '각 본문 section마다 해당 소제목과 본문 내용에 100% 어울리는 실사 라이프스타일 사진 프롬프트(imageQuery)를 영문 10~20단어로 구체적으로 작성하세요.',
    '1. 인물/동작 묘사: 건강, 운동, 스트레칭, 일상 주제는 실제 동작을 시각적으로 명확히 묘사해야 합니다. 단정한 일상복 또는 애슬레저룩을 입은 인물이 올바른 자세를 취하는 모습 (예: "A Korean young adult in clean casual sportswear gently stretching neck sideways with one hand", "A person in comfortable clothes doing gentle shoulder rolls in bright room")으로 작성하세요.',
    '2. 공간 및 분위기: 밝고 따뜻하며 감성적인 모던 실내/거실 공간, 창가로 들어오는 부드러운 아침 자연광, 아늑한 우드 인테리어를 포함하세요 (예: "bright modern minimalist living room, warm morning sunlight filtering through window, cozy wooden interior").',
    '3. 카메라 스타일: 인스타그램/블로그 감성 스냅 사진 스타일 (예: "shot on 35mm lens, f/2.0, natural soft lighting, candid lifestyle photography, sharp details, photorealistic").',
    '4. 절대 금지: 노출, 속옷, 수영복, 가슴 강조, 선정적 자세, 신체 부위 클로즈업, 투명한 옷을 절대 지시하지 않으며, 소제목과 무관한 엉뚱한 사물(물레방아, 유아/애기엄마, 카메라 장비 등)은 일절 포함하지 마세요.',
    '5. 글 본문(body) 안에는 imageQuery나 프롬프트 영문 문구를 일절 노출하지 마세요.'
  ].join('\n')
});

function buildConfiguredUserPrompt(promptConfig, context) {
  if (!promptConfig?.userPromptTemplate) return JSON.stringify(context);
  const expanded = String(promptConfig.userPromptTemplate)
    .replaceAll('{{topic}}', String(context.topic || context.sourceTitle || ''))
    .replaceAll('{{content}}', String(context.userPrompt || context.additionalNotes || context.sourceContent || ''));
  return `${expanded}\n\n구조화 입력 JSON:\n${JSON.stringify(context)}`;
}

export function parseLlmJson(content = '') {
  const raw = String(content || '').trim();
  if (!raw) throw new Error('LLM 응답이 비어있습니다.');

  // 1. Strip markdown code block wrappers
  const direct = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '').trim();
  try {
    return JSON.parse(direct);
  } catch {}

  // 2. Search for outermost JSON object { ... }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = raw.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  throw new Error(`로컬 LLM이 올바른 JSON 형식으로 글을 완성하지 못했습니다: ${raw.slice(0, 120)}...`);
}

export function normalizeGeneratedPost(value = {}, deals = []) {
  const isDealsPost = Array.isArray(deals) && deals.length > 0;
  const title = (isDealsPost ? cleanDealTitle(value.title) : sanitizeGeneratedText(value.title)).slice(0, 200);
  const content = sanitizeGeneratedText(isDealsPost
    ? composeStructuredPost(value, deals)
    : (value.content || composeStructuredPost(value, deals))).slice(0, 50000);
  const sections = (Array.isArray(value.sections) ? value.sections : []);
  const sectionHeadings = sections
    .map((section) => String(section?.heading || '').trim())
    .filter(Boolean)
    .slice(0, 6);
  const requestedTags = (Array.isArray(value.tags) ? value.tags : [])
    .map((tag) => String(tag).replace(/^#+/, '').trim())
    .filter(Boolean);
  const tags = [...new Set((isDealsPost
    ? [...requestedTags.filter((tag) => !/알구몬/i.test(tag)), '오늘의핫딜', '쇼핑정보', '특가정보']
    : requestedTags))].slice(0, 10);
  const fallbackQueries = [...new Set((Array.isArray(value.imageQueries) ? value.imageQueries : [])
    .map((query) => String(query).trim())
    .filter((query) => query.length >= 2))].slice(0, 6);

  const imagePlans = [];
  (isDealsPost ? deals : sections).forEach((_item, index) => {
    const section = sections[index] || {};
    const heading = isDealsPost
      ? dealSectionHeading(deals[index], index)
      : String(section?.heading || '').trim();
    const afterHeading = isDealsPost
      ? dealInfoLine(section, deals[index])
      : heading;
    const query = String(section?.imageQuery || (deals[index] ? deals[index].title : fallbackQueries[index]) || '').trim();
    const deal = deals[index];
    if (heading && query && query.length >= 2 && imagePlans.length < (deals.length || 3)) {
      imagePlans.push({
        query,
        afterHeading,
        dealImage: deal?.image || '',
        dealUrl: deal?.url || '',
        dealTitle: deal?.title || ''
      });
    }
  });

  if (!imagePlans.length && fallbackQueries.length) {
    fallbackQueries.slice(0, 3).forEach((query, index) => {
      imagePlans.push({
        query,
        afterHeading: sectionHeadings[Math.min(index, Math.max(sectionHeadings.length - 1, 0))] || ''
      });
    });
  }

  const imageQueries = imagePlans.map((plan) => plan.query);
  const summaryPoints = Array.isArray(value.summaryPoints) ? value.summaryPoints.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const visualCards = Array.isArray(value.visualCards) ? value.visualCards : [];
  if (title.length < 2 || content.length < 100) throw new Error('로컬 LLM이 완성된 글을 반환하지 못했습니다. 다시 작성해주세요.');
  return { title, content, tags, imageQueries, sectionHeadings, imagePlans, summaryPoints, visualCards };
}

export class LocalLlmClient {
  constructor({ baseUrl, model, fetchImpl = fetch, timeoutMs = 90000 }) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async callChatCompletion(bodyPayload) {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify(bodyPayload)
      });

      if (response.ok) {
        return await response.json();
      }

      // If json_schema is rejected or fails, retry with json_object
      if (bodyPayload.response_format?.type === 'json_schema') {
        const fallbackPayload = {
          ...bodyPayload,
          response_format: { type: 'json_object' }
        };
        const fallbackRes = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify(fallbackPayload)
        });
        if (fallbackRes.ok) return await fallbackRes.json();
      }

      const errorText = await response.text().catch(() => '');
      throw new Error(`LLM 서버 응답 오류 (${response.status}): ${errorText || response.statusText}`);
    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        throw new Error('로컬 LLM 응답 시간이 초과되었습니다 (90초). GPU 가속 상태를 확인해주세요.');
      }
      if (err.cause?.code === 'ECONNREFUSED' || err.message.includes('fetch failed')) {
        throw new Error('선택한 로컬 LLM 엔진이 시작되지 않았거나 로딩 중입니다. 잠시 후 다시 시도해주세요.');
      }
      throw err;
    }
  }

  async callJsonCompletion(bodyPayload) {
    const first = await this.callChatCompletion(bodyPayload);
    const firstContent = first?.choices?.[0]?.message?.content || '';
    try {
      return parseLlmJson(firstContent);
    } catch (firstError) {
      const retryPayload = {
        ...bodyPayload,
        messages: [
          ...bodyPayload.messages,
          {
            role: 'user',
            content: '방금 응답은 JSON이 중간에 잘렸거나 문법이 올바르지 않았습니다. 내용을 생략하거나 말줄임표를 쓰지 말고, 모든 필수 필드와 배열을 끝까지 닫은 완전한 JSON 객체 하나만 처음부터 다시 출력하세요.'
          }
        ],
        temperature: Math.min(Number(bodyPayload.temperature ?? 0.6), 0.35),
        max_tokens: Math.max(Number(bodyPayload.max_tokens || 4096), 6144)
      };
      const retried = await this.callChatCompletion(retryPayload);
      try {
        return parseLlmJson(retried?.choices?.[0]?.message?.content || '');
      } catch {
        throw new Error(`로컬 LLM이 JSON 글쓰기를 두 번 연속 완성하지 못했습니다. 글 분량을 줄이거나 다시 시도해주세요. 첫 오류: ${firstError.message}`);
      }
    }
  }

  async generateBlogPost({ topic, newsTitle = '', source = '', sourceUrl = '', tone = 'informative', length = 'medium', notes = '', model = '', avoidHistory = [], promptConfig = null }) {
    const toneGuide = {
      informative: '전문적이면서도 이해하기 쉬운 친절한 톤앤매너. 정보 전달력이 높고 명확한 어조',
      friendly: '친근하고 다정한 대화체 블로그 톤앤매너. 생생한 감탄사와 구어체 표현(~해요, ~해보셨나요?, ~해보세요!)을 적절히 활용하여 공감대를 형성하는 스타일',
      review: '직접 경험하거나 후기를 전달하듯 솔직하고 생생한 사용기/체험기 톤앤매너. 장단점과 꿀팁을 친근하게 나누는 분위기'
    };

    const parsed = await this.callJsonCompletion({
      model: model || this.model,
      messages: [
        {
          role: 'system',
          content: promptConfig
            ? [promptConfig.systemPrompt, promptConfig.imagePromptInstructions].filter(Boolean).join('\n')
            : [DEFAULT_PROMPT_CONFIG.systemPrompt, DEFAULT_PROMPT_CONFIG.imagePromptInstructions].join('\n')
        },
        {
          role: 'user',
          content: buildConfiguredUserPrompt(promptConfig, {
            topic,
            relatedHeadline: newsTitle,
            source,
            sourceUrl,
            tone,
            desiredLength: LENGTH_GUIDE[length] || LENGTH_GUIDE.medium,
            additionalNotes: notes,
            userPrompt: [topic, notes].filter(Boolean).join('\n\n'),
            previouslyPublishedToAvoid: avoidHistory
          })
        }
      ],
      temperature: 0.65,
      max_tokens: 4096,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'naver_blog_post',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              lead: { type: 'string' },
              summaryPoints: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
              sections: {
                type: 'array',
                minItems: 3,
                maxItems: 5,
                items: {
                  type: 'object',
                  properties: {
                    heading: { type: 'string' },
                    body: { type: 'string' },
                    imageQuery: { type: 'string' }
                  },
                  required: ['heading', 'body', 'imageQuery'],
                  additionalProperties: false
                }
              },
              closing: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              imageQueries: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 }
            },
            required: ['title', 'lead', 'summaryPoints', 'sections', 'closing', 'tags', 'imageQueries'],
            additionalProperties: false
          }
        }
      }
    });

    return normalizeGeneratedPost(parsed);
  }

  async generateDealsBlogPost({ deals = [], tone = 'informative', length = 'medium', notes = '', model = '' }) {
    if (!deals.length) throw new Error('작성할 핫딜 목록이 비어있습니다.');
    
    const dealsSummary = deals.map((d, index) => `${index + 1}위: [${d.shop || '쇼핑몰'}] ${d.title} (특가: ${d.price}, 배송: ${d.shipping}) - 링크: ${d.url || ''}`).join('\n');
    const toneGuide = {
      informative: '전문적이면서도 이해하기 쉬운 친절한 톤앤매너. 정보 전달력이 높고 명확한 어조',
      friendly: '친근하고 다정한 대화체 블로그 톤앤매너 (~해요, ~해보셨나요?, ~해보세요!)',
      review: '직접 경험하거나 후기를 전달하듯 솔직하고 생생한 사용기/체험기 톤앤매너'
    };

    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: model || this.model,
        messages: [
          {
            role: 'system',
            content: [
              '당신은 네이버 블로그 인기 쇼핑/핫딜 전문 파워블로거다.',
              '수집된 실시간 인기 핫딜 목록을 바탕으로 독자에게 실질적인 혜택을 알려주는 매력적인 블로그 글을 작성한다.',
              `글의 톤앤매너: ${toneGuide[tone] || toneGuide.informative}`,
              '작성 가이드:',
              '1. 제목: 독자의 눈길을 사로잡는 오늘의 핫딜 모음 타이틀 (예: [오늘의 핫딜] 실시간 인기 특가 TOP 5 총정리 (메가커피·오뚜기 외))',
              '2. 도입(lead): 오늘 반응이 뜨거운 최저가 핫딜 TOP 5를 소개하는 생생하고 유용한 오프닝. 수집 사이트 이름은 글에 쓰지 않는다.',
              '3. 핵심 요약(summaryPoints): 이번 핫딜 모음에서 가장 주목할 만한 3가지 핵심 혜택/상품 포인트.',
              `4. 본문 세션(sections): 전달받은 핫딜 ${deals.length}개 각각에 대해 1:1로 소제목(heading)과 본문(body)을 작성한다.`,
              '   - 소제목 형식 예시: 1위. [쇼핑몰명] 상품명 (특가가격)',
              '   - 본문 내용: 전달받은 상품명·특가·배송 정보만 사실로 사용하고, 확인되지 않은 정상가·할인율·성능·재질·사용 경험은 만들지 않는다.',
              '   - 가격 옆 수량·단가 계산식은 총가격이나 1인분 가격으로 해석하지 않는다.',
              '   - imageQuery: 각 상품과 어울리는 영문 키워드 1~3단어.',
              '5. 마무리(closing): 핫딜 특성상 조기 품절이나 가격 변동이 있을 수 있다는 안내 및 공감/댓글/이웃추가 유도 멘트.',
              '6. 태그(tags): 핫딜, 특가, 최저가, 쇼핑정보, 그리고 각 상품명 관련 키워드 5~8개. 수집 사이트 이름은 태그에 쓰지 않는다.',
              '주의: 이모지, 이모티콘, 장식 기호, 반복 감탄사, 과장 광고 문구를 사용하지 않는다.',
              'body 안에는 imageQuery 같은 필드명이나 검색어를 적지 않는다.',
              '마크다운(#, **, __ 등) 없이 순수 텍스트로 작성하며 JSON 구조를 정확히 지킨다.'
            ].join('\n')
          },
          {
            role: 'user',
            content: JSON.stringify({
              topic: '실시간 인기 핫딜 TOP 5 모음',
              dealsSummary,
              dealsCount: deals.length,
              tone,
              desiredLength: LENGTH_GUIDE[length] || LENGTH_GUIDE.medium,
              additionalNotes: notes
            })
          }
        ],
        temperature: 0.65,
        max_tokens: 4096,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'naver_deals_blog_post',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                lead: { type: 'string' },
                summaryPoints: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
                sections: {
                  type: 'array',
                  minItems: deals.length,
                  maxItems: Math.max(deals.length, 5),
                  items: {
                    type: 'object',
                    properties: {
                      heading: { type: 'string' },
                      body: { type: 'string' },
                      imageQuery: { type: 'string' }
                    },
                    required: ['heading', 'body', 'imageQuery'],
                    additionalProperties: false
                  }
                },
                closing: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                imageQueries: { type: 'array', items: { type: 'string' } }
              },
              required: ['title', 'lead', 'summaryPoints', 'sections', 'closing', 'tags', 'imageQueries'],
              additionalProperties: false
            }
          }
        }
      })
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`112 로컬 LLM 핫딜 글작성 오류 (${response.status}): ${details}`);
    }
    const payload = await response.json();
    const rawContent = payload?.choices?.[0]?.message?.content;
    const parsed = parseLlmJson(rawContent);
    return normalizeGeneratedPost(parsed, deals);
  }

  async generateArticleRewriteBlogPost({ sourceTitle = '', sourceContent = '', sourceUrl = '', tone = 'friendly', length = 'medium', notes = '', customFocus = '', model = '', avoidHistory = [], promptConfig = null }) {
    const toneGuide = {
      informative: '전문적이면서도 독자가 쉽게 이해할 수 있는 명쾌하고 신뢰감 있는 정보 전달 톤앤매너',
      friendly: '친근하고 다정한 대화체 블로그 톤앤매너 (~해요, ~해보셨나요?, 생생한 후기형 소통)',
      review: '직접 체험하고 분석한 듯한 솔직담백한 리뷰 및 통찰력 있는 평가 톤앤매너',
      column: '트렌드를 분석하고 깊이 있는 시각을 제시하는 스마트한 인사이트 칼럼 톤앤매너'
    };

    const parsed = await this.callJsonCompletion({
      model: model || this.model,
      messages: [
        {
          role: 'system',
          content: promptConfig
            ? [promptConfig.systemPrompt, promptConfig.imagePromptInstructions].filter(Boolean).join('\n')
            : [DEFAULT_PROMPT_CONFIG.systemPrompt, DEFAULT_PROMPT_CONFIG.imagePromptInstructions].join('\n')
        },
        {
          role: 'user',
          content: buildConfiguredUserPrompt(promptConfig, {
            topic: customFocus || sourceTitle,
            sourceTitle,
            sourceContent: sourceContent.slice(0, 4000),
            sourceUrl,
            tone,
            desiredLength: LENGTH_GUIDE[length] || LENGTH_GUIDE.medium,
            customFocus,
            additionalNotes: notes,
            userPrompt: [sourceTitle, customFocus, notes].filter(Boolean).join('\n\n'),
            previouslyPublishedToAvoid: avoidHistory
          })
        }
      ],
      temperature: 0.7,
      max_tokens: 4096,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'naver_article_rewrite_post',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              lead: { type: 'string' },
              summaryPoints: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
              sections: {
                type: 'array',
                minItems: 3,
                maxItems: 5,
                items: {
                  type: 'object',
                  properties: {
                    heading: { type: 'string' },
                    body: { type: 'string' },
                    imageQuery: { type: 'string' }
                  },
                  required: ['heading', 'body', 'imageQuery'],
                  additionalProperties: false
                }
              },
              closing: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              imageQueries: { type: 'array', items: { type: 'string' } }
            },
            required: ['title', 'lead', 'summaryPoints', 'sections', 'closing', 'tags', 'imageQueries'],
            additionalProperties: false
          }
        }
      }
    });

    return normalizeGeneratedPost(parsed);
  }

  async selectRelevantImages({ topic, plans = [] }) {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: [
              '당신은 블로그 사진 편집자다.',
              '각 소제목의 의미와 실제로 직접 관련된 사진 한 장을 후보에서 고른다.',
              '단순히 단어 하나가 겹치거나 행사 포스터, 문서 스캔, 로고, 밈, 상품 광고인 후보는 피한다.',
              '사진의 제목과 설명이 불명확하면 선택하지 말고 imageId를 빈 문자열로 반환한다.',
              'caption은 사진이 해당 문단과 어떻게 연결되는지 설명하는 짧은 한국어 문장으로 쓴다.',
              'JSON만 출력한다.'
            ].join('\n')
          },
          { role: 'user', content: JSON.stringify({ topic, plans }) }
        ],
        temperature: 0,
        max_tokens: 1200,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'blog_image_selections',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                selections: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      planIndex: { type: 'integer' },
                      imageId: { type: 'string' },
                      caption: { type: 'string' }
                    },
                    required: ['planIndex', 'imageId', 'caption'],
                    additionalProperties: false
                  }
                }
              },
              required: ['selections'],
              additionalProperties: false
            }
          }
        }
      })
    });
    if (!response.ok) throw new Error(`112 로컬 LLM 이미지 선별 오류 (${response.status})`);
    const data = await response.json();
    const parsed = parseLlmJson(data.choices?.[0]?.message?.content);
    return Array.isArray(parsed.selections) ? parsed.selections : [];
  }
}

function composeStructuredPost(value, deals = []) {
  const summaryPoints = (Array.isArray(value.summaryPoints) ? value.summaryPoints : [])
    .map((point) => String(point).trim())
    .filter(Boolean)
    .slice(0, 3);
  
  const isDealsPost = Array.isArray(deals) && deals.length > 0;
  const lead = isDealsPost
    ? sanitizePublicDealText(value.lead)
    : String(value.lead || '').trim();

  const generatedSections = Array.isArray(value.sections) ? value.sections : [];
  const sections = (isDealsPost ? deals : generatedSections)
    .map((_item, index) => {
      const section = generatedSections[index] || {};
      const heading = String(section?.heading || '').trim();
      const body = String(section?.body || '').trim();

      if (isDealsPost) {
        const deal = deals[index];
        const shopInfo = `판매처 | ${sanitizePublicDealText(deal?.shop) || '상품 페이지에서 확인'}`;
        const priceInfo = `가격 | ${sanitizePublicDealText(deal?.price) || '상품 페이지에서 확인'}`;
        const shipInfo = deal?.shipping ? `배송 | ${sanitizePublicDealText(deal.shipping)}` : '';
        const infoLine = dealInfoLine(section, deal);
        const linkLines = deal?.url
          ? ['상품 페이지 | 아래 파란 주소를 클릭하세요.', String(deal.url).trim()]
          : ['상품 페이지 | 링크를 가져오지 못했습니다. 발행 전에 확인해주세요.'];

        return [
          '────────────────────────',
          dealSectionHeading(deal, index),
          shopInfo,
          priceInfo,
          shipInfo,
          infoLine,
          ...linkLines
        ].filter(Boolean).join('\n');
      }

      if (!heading || !body) return null;
      return `✨ ${heading}\n\n${body}`;
    })
    .filter(Boolean);

  const closing = isDealsPost
    ? sanitizePublicDealText(value.closing)
    : String(value.closing || '').trim();

  const blocks = [];
  if (lead) blocks.push(lead);
  
  if (summaryPoints.length) {
    if (isDealsPost) {
      blocks.push([
        '오늘의 핫딜 한눈에 보기',
        ...deals.map((deal) => `- ${sanitizePublicDealText(deal?.title) || '상품명 확인 필요'} | ${sanitizePublicDealText(deal?.price) || '가격 확인 필요'}`)
      ].join('\n'));
    } else {
      blocks.push(`📌 오늘의 핵심 요약\n\n${summaryPoints.map((point) => `• ${point}`).join('\n')}`);
    }
  }

  blocks.push(...sections);

  if (closing) {
    if (isDealsPost) {
      blocks.push([
        '────────────────────────',
        '마무리',
        closing,
        '핫딜은 가격이 변동되거나 조기에 품절될 수 있으니 상품 페이지에서 최종 조건을 확인해주세요.'
      ].filter(Boolean).join('\n'));
    } else {
      blocks.push(closing);
    }
  }

  return blocks.filter(Boolean).join('\n\n');
}

function dealSectionHeading(deal, index) {
  return `상품 ${index + 1} | ${sanitizePublicDealText(deal?.title) || '상품명 확인 필요'}`;
}

function dealInfoLine(section, deal) {
  const generated = sanitizePublicDealText(section?.body)
    .replace(/^상품\s*정보\s*[|:]\s*/i, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const fallbackTitle = sanitizePublicDealText(deal?.title);
  const description = generated || (fallbackTitle
    ? `${fallbackTitle} 상품입니다. 상세 조건은 상품 페이지에서 확인해주세요.`
    : '상세 조건은 상품 페이지에서 확인해주세요.');
  return `상품 정보 | ${description}`;
}

function sanitizePublicDealText(value) {
  return sanitizeGeneratedText(value)
    .replace(/알구몬/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanDealTitle(value) {
  return sanitizePublicDealText(value)
    .replace(/\[\s*\]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeGeneratedText(value) {
  return String(value || '')
    .replace(/^\s*imageQuery\s*:.*$/gim, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/!{2,}/g, '!')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
