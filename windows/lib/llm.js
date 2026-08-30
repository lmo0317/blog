const LENGTH_GUIDE = {
  short: '700~1,000자',
  medium: '1,200~1,800자',
  long: '2,000~3,000자'
};

export function parseLlmJson(content = '') {
  const normalized = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(normalized);
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
  if (title.length < 2 || content.length < 100) throw new Error('로컬 LLM이 완성된 글을 반환하지 못했습니다. 다시 작성해주세요.');
  return { title, content, tags, imageQueries, sectionHeadings, imagePlans };
}

export class LocalLlmClient {
  constructor({ baseUrl, model, fetchImpl = fetch, timeoutMs = 90000 }) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async generateBlogPost({ topic, newsTitle = '', source = '', sourceUrl = '', tone = 'informative', length = 'medium', notes = '' }) {
    const toneGuide = {
      informative: '전문적이면서도 이해하기 쉬운 친절한 톤앤매너. 정보 전달력이 높고 명확한 어조',
      friendly: '친근하고 다정한 대화체 블로그 톤앤매너. 생생한 감탄사와 구어체 표현(~해요, ~해보셨나요?, ~해보세요!)을 적절히 활용하여 공감대를 형성하는 스타일',
      review: '직접 경험하거나 후기를 전달하듯 솔직하고 생생한 사용기/체험기 톤앤매너. 장단점과 꿀팁을 친근하게 나누는 분위기'
    };

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
              '당신은 네이버 블로그 인기 파워블로거이자 매력적인 스토리텔러 에디터다.',
              '독자의 흥미를 사로잡는 몰입감 있고 재미있는 한국어 블로그 글을 작성한다.',
              `글의 톤앤매너: ${toneGuide[tone] || toneGuide.informative}`,
              '구조화 가이드:',
              '1. 제목: 독자의 호기심을 유발하는 생생하고 매력적인 타이틀 (20~40자).',
              '2. 도입(lead): 공감할 수 있는 상황이나 질문으로 시작해 독자의 주의를 끌고 글에서 얻을 핵심 가치를 흥미진진하게 제시.',
              '3. 핵심 요약(summaryPoints): 읽는 재미와 실용성을 담은 3개의 핵심 포인트.',
              '4. 본문 세션(sections): 3~5개의 구체적인 소제목과 풍부한 예시, 스토리, 실용적 팁. 각 세션마다 해당 소제목과 가장 잘 어울리는 직관적인 영문 이미지 검색 키워드(imageQuery)를 1~3단어로 제시할 것 (예: "coffee cup on table", "hiking mountain top", "smart home setup").',
              '5. 마무리(closing): 따뜻한 인쇄 소감이나 팁 요약과 함께 댓글/공감을 유도하는 질문 및 액션 제안.',
              '주의: 마크다운 기호 없이 순수 텍스트로만 내용을 채우며 지정된 JSON 구성을 정확히 지킨다.'
            ].join('\n')
          },
          {
            role: 'user',
            content: JSON.stringify({
              topic,
              relatedHeadline: newsTitle,
              source,
              sourceUrl,
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
      })
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`112 로컬 LLM 응답 오류 (${response.status}): ${details}`);
    }
    const data = await response.json();
    return normalizeGeneratedPost(parseLlmJson(data.choices?.[0]?.message?.content));
  }

  async generateDealsBlogPost({ deals = [], tone = 'informative', length = 'medium', notes = '' }) {
    if (!deals.length) throw new Error('작성할 핫딜 목록이 비어있습니다.');
    
    const toneGuide = {
      informative: '전문적이면서도 이해하기 쉬운 친절한 쇼핑 가이드 톤앤매너. 가격 혜택과 정보를 명확하게 정리하는 어조',
      friendly: '친근하지만 차분한 이웃 대화체. 과장된 감탄사 없이 상품 정보와 활용 팁을 자연스럽게 설명하는 스타일',
      review: '실제 득템 후기처럼 꼼꼼하고 생생한 추천 톤앤매너. 가성비와 실사용 관점의 장단점을 짚어주는 분위기'
    };

    const dealsSummary = deals.map((d, i) => {
      const promptPrice = String(d.price || '').replace(/\([^)]*\bx\b[^)]*\)/gi, '').replace(/\s+/g, ' ').trim();
      return `${i + 1}위. [${d.shop}] ${d.title} | 특가가격: ${promptPrice} | 배송: ${d.shipping} | 링크: ${d.url}`;
    }).join('\n');

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

  async generateArticleRewriteBlogPost({ sourceTitle = '', sourceContent = '', sourceUrl = '', tone = 'friendly', length = 'medium', notes = '', customFocus = '' }) {
    const toneGuide = {
      informative: '전문적이면서도 독자가 쉽게 이해할 수 있는 명쾌하고 신뢰감 있는 정보 전달 톤앤매너',
      friendly: '친근하고 다정한 대화체 블로그 톤앤매너 (~해요, ~해보셨나요?, 생생한 후기형 소통)',
      review: '직접 체험하고 분석한 듯한 솔직담백한 리뷰 및 통찰력 있는 평가 톤앤매너',
      column: '트렌드를 분석하고 깊이 있는 시각을 제시하는 스마트한 인사이트 칼럼 톤앤매너'
    };

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
              '당신은 네이버 블로그 최고의 인기 파워블로거이자 전문 콘텐츠 에디터다.',
              '제공된 뉴스 기사나 포스팅 원문을 있는 그대로 베끼지 않고, 핵심 가치와 인사이트를 완벽히 재해석(Reinterpretation)하여 독창적이고 매력적인 고품질 블로그 글을 새롭게 창작한다.',
              `글의 톤앤매너: ${toneGuide[tone] || toneGuide.friendly}`,
              '작성 가이드:',
              '1. 제목(title): 원문 제목을 복사하지 말고, 검색 유입과 클릭을 극대화하는 매력적인 블로그 타이틀로 재창작 (25~45자).',
              '2. 도입(lead): 독자의 궁금증을 자극하거나 일상 공감대를 형성하며, 이 글을 읽어야 하는 이유를 흥미진진하게 소개.',
              '3. 핵심 포인트(summaryPoints): 바쁜 현대인을 위한 3줄 핵심 요약.',
              '4. 본문 세션(sections): 3~4개의 명확한 소제목(heading)과 함께 알찬 배경 설명, 구체적 사례, 실생활 적용 팁/인사이트(body). 각 세션마다 어울리는 고품질 영문 이미지 검색 키워드(imageQuery)를 1~3단어로 작성 (예: "business meeting discussion", "smartphone technology app", "healthy food recipe").',
              '5. 마무리(closing): 작성자의 개인적 소감/총평과 함께 독자의 생각을 묻는 공감 및 댓글 유도 질문.',
              '6. 태그(tags): 주제 및 핵심 키워드 중심의 인기 네이버 해시태그 8~10개.',
              '주의: 마크다운(#, **, __ 등) 기호 없이 깔끔한 순수 텍스트로 작성하며 JSON 구조를 완벽히 준수한다.'
            ].join('\n')
          },
          {
            role: 'user',
            content: JSON.stringify({
              sourceTitle,
              sourceContent: sourceContent.slice(0, 4000),
              sourceUrl,
              tone,
              desiredLength: LENGTH_GUIDE[length] || LENGTH_GUIDE.medium,
              customFocus,
              additionalNotes: notes
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
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`LLM 응답 실패 (${response.status}): ${errorText || response.statusText}`);
    }

    const payload = await response.json();
    const rawContent = payload?.choices?.[0]?.message?.content;
    const parsed = parseLlmJson(rawContent);
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
      return `[ ${heading} ]\n\n${body}`;
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
      blocks.push(`[한눈에 보기]\n${summaryPoints.map((point) => `• ${point}`).join('\n')}`);
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
