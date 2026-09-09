---
name: naver-auto-posting
description: Research a useful and timely topic or analyze real-time Creator Advisor trends (https://creator-advisor.naver.com/naver_blog/<blogId>/trends#trend-by-categories), write a source-grounded Korean article, generate section-matched Gemini images (Google Imagen), route it to the correct Naver category, and publish through Naver SmartEditor or the authenticated publishing helper. Use when the user asks to choose a topic, requests a trend-based post ('트렌드글 포스팅 해줘'), or complete Naver Blog posting. Do not use when the user wants only a draft, prompt, or engagement automation.
---

# Naver Auto Posting

Choose, research, create, and publish one complete Naver Blog post. Optimize for genuine reader usefulness and close correspondence between each image and the nearby text.

## Scope and authorization

- Work in `D:\work\dev\blog` for generated assets and records. Publish directly using the authenticated publishing script (`scripts/publish-post.js`) or the Playwright browser session (`windows/lib/naver.js`).
- **Natively Gemini-powered**: Never use OpenAI, GPT, DALL-E, or external paid APIs. Write the final article directly in Gemini with authoritative research, and generate every requested image using Gemini's built-in `generate_image` tool (Google Imagen engine).
- A request to use this skill for posting authorizes one new Naver post. Draft-only requests do not authorize publication. A request to revise identified published posts authorizes updating only those posts while preserving their existing URLs.
- Do not overwrite an existing post, publish promotional claims, or perform engagement actions unless the user separately requests them.
- If a publish attempt fails, verify that no public post was created before one corrected retry. Never retry blindly or create duplicates.
- Use an existing authenticated Naver browser session (`.data/auth/naver_user_data` or `.playwright/naver-session.json`). Never retrieve, infer, store, log, or ask the user to paste a Naver password, cookie, token, or one-time authentication code into chat.
- If Naver requires login, CAPTCHA, two-step verification, or new-device approval, pause and ask the user to complete that step directly in the browser. Resume only after confirming the signed-in account is the intended blog owner.

## Topic selection & Trend analysis

### Standard Topic Selection
1. Before choosing or drafting any topic, read [references/published-posts/INDEX.md](references/published-posts/INDEX.md). Compare the candidate against every stored title, topic key, core claim, and practical action. When similarity is unclear, read the linked full post file.
2. Treat a candidate as overlapping when it repeats the same reader problem, central recommendation, or substantially the same action list, even if the title or wording differs. Reject it and choose a meaningfully different subject or angle. A narrower rewrite of an existing post is not sufficiently different unless the user explicitly requests a follow-up.
3. If the user supplies a topic that overlaps, preserve the user's intent but briefly disclose the overlap and propose a distinct angle before publishing. Never silently republish near-duplicate material.
4. Otherwise research current, broadly useful subjects and select one with clear practical value. Prefer evergreen household tips, digital-life guidance, seasonal living information, consumer know-how, parenting ideas, simple food knowledge, low-risk wellness habits, or dev/automation tech tips.
5. Avoid topics that require personal diagnosis, individualized legal or financial advice, unverified breaking rumors, copyrighted article reproduction, or claims that cannot be supported by authoritative sources.
6. Search current authoritative or primary sources using `search_web`. Record the source URLs for the completion report. Reinterpret and synthesize; never closely copy a source article.

### Trend-Driven Topic Selection (네이버 크리에이터 어드바이저 트렌드 연동)
When the user asks "트렌드글 포스팅 해줘", "트렌드 분석해서 글 써줘", or requests a post based on current Naver trends:

1. **Fetch Live Trends from Creator Advisor**:
   Run the trend helper script to fetch real-time category search inflow and rising topics from `https://creator-advisor.naver.com/naver_blog/lmo0317/trends#trend-by-categories`:
   ```powershell
   node .agents/skills/naver-auto-posting/scripts/fetch-creator-trends.js
   ```
   Read [references/creator-advisor-trends.md](references/creator-advisor-trends.md) for endpoint details and options.

2. **Automated Zero-Overlap & Prioritization**:
   The script automatically cross-references `references/published-posts/INDEX.md` and filters out already published topics (e.g. marking `[기발행]`), while highlighting candidates with `🔥 NEW` surge, high positive `rankChange`, and strong practical value.

3. **Select High-Value Actionable Trend Topic**:
   Pick the top non-overlapping trend query with strong informational and practical value for readers:
   - Seasonal health/nutrition (e.g., 가을 제철 "무화과 효능 & 올바른 세척·보관법");
   - Seasonal cooking & food handling (e.g., 가을 제철 "꽃게 손질법 & 비린내 없이 찌는 법");
   - Practical living & recycling tips (e.g., "이불 버리는 방법 - 대형폐기물 스티커 vs 종량제 봉투");
   - Trending life hacks & organizer items (e.g., "다이소 품절대란 정리 꿀템 실사용 팁").

4. **Proceed to Premium Quality, Images, and Publishing**:
   Search authoritative sources using `search_web`, draft the 2,500–3,800 character article (minimum 2,200 characters excluding spaces and tags), generate 3 section-matched Gemini Imagen images, publish to the correct category (`건강`, `생활`, etc.), verify the live URL, and archive in `references/published-posts/`.

## Article quality (정성스럽고 깊이 있는 프리미엄 포스팅 원칙)

독자가 글을 읽었을 때 "단순 AI 요약글이나 백과사전이 아니라, 진짜 살림·건강 전문가가 정성을 다해 쓴 글"이라는 신뢰와 감동을 느낄 수 있도록 아래의 고품질 작성 원칙을 반드시 준수합니다.

### 1. 글자 수 및 정보 밀도 (Depth & Volume Gate)
- **분량 기준**: 순수 본문 기준 **2,500 ~ 3,800자 (공백 제외 2,200자 이상 의무화)**를 철저히 지킵니다. (태그, 출처 URL 제외)
- **무의미한 패딩 금지**: 같은 말을 반복하는 말 늘리기가 아니라, **구체적인 수치(온도, 비율, g/ml 용량, 분/초 단위 시간), 과학적·의학적·조리적 원리, 실제 발생 가능한 돌발 상황별 해결책**으로 정보 밀도를 촘촘하게 채웁니다.
- **발행 게이트**: 작성 완료 후 공백 제외 글자 수를 계산하여 2,200자 미만일 경우, 심층 팁과 FAQ를 추가 보강하기 전까지는 절대 발행하지 않습니다.

### 2. 공감형 스토리텔링 도입부 (Empathy & Reader Hook)
- 건조하고 딱딱한 백과사전식 도입("~에 대해 알아보겠습니다", "최근 ~가 인기입니다")을 **전면 금지**합니다.
- 독자가 일상에서 겪었을 법한 **구체적인 곤란한 상황, 당황했던 에피소드, 흔히 겪는 착오**를 생생하게 묘사하여 3초 안에 독자의 깊은 공감을 이끌어냅니다.
  *(예: "장바구니에 담아올 땐 뿌듯했는데, 막상 싱크대 앞에 서서 손질할 생각에 한숨부터 나오셨던 적 다들 있으시죠?", "아침에 일어났는데 갑자기 핑 돌며 식은땀이 비 오듯 쏟아져 덜컥 겁이 났던 경험...")*
- 왜 이 글이 지금 독자의 고민을 해결하는 데 반드시 필요한지 명확한 이유를 제시합니다.

### 3. 정성스러운 글의 5대 필수 시그니처 구성요소 (Signature Elements)
모든 포스팅은 다음 5가지 요소를 본문 속에 유기적으로 반드시 포함해야 합니다:

1. **[바쁜 분들을 위한 3줄 핵심 요약]**: 도입부 끝 또는 글 서두에 바쁜 독자를 위해 전체 핵심 결론과 필수 행동 요령을 3줄로 깔끔하게 정리한 박스/문단 제공. (불필요한 이모지 남발 금지)
2. **[흔히 저지르는 치명적 실수 TOP 3 / 실패 방지 꿀팁]**: 초보자들이 실제로 가장 많이 실패하는 포인트와 그 이유, 그리고 해결책을 구체적으로 짚어줌 (*"대부분 여기서 실패합니다", "주의해야 할 점"*).
3. **[한눈에 쏙 들어오는 비교/체크리스트 요약]**: 상황별 비교(A vs B, 모델별 차이, 전/후 비교)나 단계별 점검 체크리스트를 **마크다운 표 기호(|---|)를 쓰지 않고**, 깔끔한 불릿 포인트와 비교 카드 형식(`▶ 항목명: 내용`, `• 세부 설명`)으로 일목요연하게 제공.
4. **[독자들이 가장 많이 묻는 실전 Q&A (FAQ 2~3선)]**: 댓글로 자주 물어볼 법한 실전 궁금증(보관 기한, 대체 재료, 주의 대상, 부작용 등)을 사전에 명쾌하게 해소.
5. **[전문가의 한 끗 차이 살림/업무 꿀팁 (Secret Pro-Tip)]**: 일반인은 잘 모르는 1%의 실전 비법을 짚어주어 글의 소장 가치를 극대화.

### 4. 사람이 직접 쓴 블로그 서식 원칙 (마크다운 특수문자 및 어색한 이모지 전면 금지)
네이버 스마트에디터 ONE은 마크다운 문법을 HTML로 자동 렌더링하지 않고 텍스트 그대로 타이핑하므로, 마크다운 특수문자가 노출되면 심각한 AI 티가 나고 독자의 신뢰를 완전히 잃게 됩니다. "진짜 사람이 정성껏 쓴 글"처럼 보이도록 다음 서식 규칙을 100% 강제합니다:

- **제목 해시태그(`###`, `##`, `#`) 절대 금지**: 소제목 앞에 `###` 기호를 절대 쓰지 않는다. `1. 소제목`, `2. 소제목` 또는 `[소제목]` 형태로 깔끔하고 자연스럽게 작성한다.
- **마크다운 표 기호(`| :--- | :--- |`, `|---|`) 절대 금지**: 표 문법은 텍스트 에디터에서 깨진 파이프(|)와 하이픈(-) 찌꺼기로 그대로 출력되어 극도로 난잡해 보인다. 비교나 정리 내용은 `▶ A 모델 / B 모델` 같은 깔끔한 불릿(`•`, `·`, `▶`)과 들여쓰기 문단으로 보기 좋게 정리한다.
- **코드 블록 백틱(```) 남발 금지**: 프롬프트 예시나 가이드는 마크다운 코드 블록(```)으로 감싸지 말고, 큰따옴표나 `[프롬프트 예시]`, 꺾쇠(`-`), 또는 줄바꿈 인용 형태로 자연스럽게 서술한다.
- **과도하고 어색한 이모티콘 전면 배제 (Zero Robotic Emojis)**: 문단이나 소제목마다 `🤖`, `💡`, `⚠️`, `❓`, `🎁`, `✨` 등의 이모지를 기계적으로 붙이는 것은 전형적인 저품질 AI 생성 글의 특징이다. 단정한 기호(`[핵심 요약]`, `[주의사항]`, `•`, `▶`)를 사용하고, 전체 글에서 감정선에 맞게 최대 1~2개 이내로만 자연스럽게 제한한다.
- **인간적인 블로거 페르소나와 유려한 필력**:
  - 딱딱한 기계 번역투나 사전식 정의를 버리고, 필자가 직접 조사하고 실무에서 검증해 본 경험을 독자에게 친절히 이야기하듯 술술 읽히는 유려한 문장 구조를 갖춘다.
  - 모바일과 PC 화면에서 모두 읽기 편하도록 적절한 줄바꿈과 호흡을 유지한다.

### 5. 신뢰성과 안전성 (Authoritative Grounding)
- 건강, 안전, 의약품, 화학 세제, IT/보안 등 전문성이 요구되는 주제는 반드시 공식 발표 자료, 전문 기관 가이드 등 공신력 있는 출처에 기반하여 작성하고, 주의사항을 자연스럽게 포함합니다.
- 최대 10개의 핵심 타겟 태그를 엄선합니다.

### 6. [발행 전 절대 필수] 5대 AI 흔적 무관용 자가 검증 게이트 (Zero-AI-Clutter Gate)
포스팅을 에디터에 전송하기 직전, 아래 5개 항목을 무조건 검증해야 하며 **단 하나라도 위반 시 발행을 즉시 중단하고 수정**합니다:

1. **[무관용 1] 소제목 해시태그(`#`, `##`, `###`) 0개**: 소제목은 반드시 `1. 소제목`, `2. 소제목` 또는 `[소제목]` 형태로만 작성되어야 함.
2. **[무관용 2] 마크다운 표(`|---|`, `| :--- |`) 0개**: 스마트에디터에 깨져 나오는 표 기호는 전면 금지하며, `▶ A 모델 / B 모델` 불릿 비교 카드로만 작성되어야 함.
3. **[무관용 3] 백틱 코드 블록(```) 0개**: 프롬프트나 가이드는 큰따옴표나 들여쓰기 인용문으로 자연스럽게 풀어서 작성되어야 함.
4. **[무관용 4] 기계적 이모티콘(`🤖`, `💡`, `⚠️`, `❓`, `🎁`, `✨` 등) 남발 금지**: 제목이나 문단 머리마다 기계적으로 붙이는 이모지를 전면 삭제하고, 단정한 기호(`[핵심 요약]`, `[주의사항]`, `•`, `▶`)를 사용하며 전체 글에서 최대 1~2개 이내로만 정제되어야 함.
5. **[무관용 5] 순수 글자 수 2,200자 이상 & 유려한 인간 필력**: 공백과 특수기호를 제외한 순수 한글/영문 글자 수가 2,200자 이상이어야 하며, 기계 번역투 없이 사람이 정성을 다해 쓴 자연스러운 문장이어야 함.

## Naver category routing

발행 전 포스팅 목적에 맞춰 정확한 네이버 블로그 카테고리를 분류하여 지정합니다:

- **`IT`**: 모든 인공지능(AI), 생성형 AI, 테크 트렌드, IT 기기, 소프트웨어, 프롬프트 엔지니어링, 디지털 생산성 툴, 코딩 가이드, 로컬 LLM 관련 주제는 **반드시 `IT` 카테고리로 지정**합니다.
- **`건강`**: 질병 증상, 의학 정보, 영양제, 운동, 수면, 위생, 건강 생활 습관 등 건강 지식 관련 주제.
- **`생활`**: 살림 꿀팁, 청소, 정리수납, 식재료 손질 및 레시피, 분리배출, 다이소 등 일상생활 노하우 관련 주제.
- **⚠️ [절대 사용 금지 / 보호 카테고리] `자동화`, `개발`**:
  - `자동화`와 `개발` 카테고리는 블로그 소유자의 자체 프로그램 개발 로그 전용 카테고리입니다.
  - **자동 포스팅 시스템에서는 절대로 `자동화`나 `개발` 카테고리에 글을 발행하거나 건드리지 않아야 합니다.** (모든 AI/테크/자동화 관련 글은 무조건 **`IT`**로 분류)

네이버 발행 설정 창에서 지정된 카테고리를 정확히 선택하고 확인한 뒤 최종 발행 버튼을 누릅니다. 태그 이름만 지정하는 것은 카테고리 설정으로 인정되지 않습니다.

## Image creation and placement (Gemini Imagen)

1. **Gemini Engine Only**: All images must be generated using Gemini's native `generate_image` tool (Google Imagen engine). Do NOT use GPT, DALL-E, or external image generation APIs.
2. Unless the user requests another count, plan and publish exactly three images for each normal standalone post after the article structure is fixed. Each image must illustrate the exact section beside it, not just the broad topic.
3. Give every image a different exact `afterHeading` value copied from a real body heading. Use three distinct roles: representative scene, concrete detail or preparation, and practical action or completed result.
4. Call `generate_image` with distinct, high-quality prompts and set appropriate AspectRatio (e.g. `1:1` or `4:3` or `16:9`). Prefer natural Korean everyday scenes when people or homes are involved. Request realistic anatomy, an editorial photo look, no branding, no watermark, and no text in the image.
5. Inspect the generated image artifact. If there are any flaws, regenerate with an adjusted prompt.
6. Save or copy accepted images under `D:\work\dev\blog\output\gemini-images\<date>-<topic>\` with ordered descriptive filenames.
7. Before publishing, verify all three accepted files exist, all three anchors occur exactly in the article, and the images are not merely variants of one generic scene. Do not publish when the image count or placement contract is incomplete.

## Publish through the selected path

Read and follow [references/direct-browser-publishing.md](references/direct-browser-publishing.md) for every live publication.

1. By default, publish directly using the automated session helper:
   ```powershell
   node .agents/skills/naver-auto-posting/scripts/publish-post.js --title "<title>" --content-file "<path-to-content.txt>" --category "<category>" --tags "<tag1,tag2>" --images-file "<path-to-images.json>"
   ```
   Or instantiate `NaverBrowserSession` directly from `windows/lib/naver.js` via Node.js script.
2. The publishing engine navigates to Naver SmartEditor ONE, verifies the logged-in session, types the title and body, places each image after its designated heading, selects the category, applies tags, and clicks publish.
3. If authentication is required, pause at the visible login page for the user as described under **Scope and authorization**.
4. Publish once and capture the resulting numeric Naver post URL (e.g. `https://blog.naver.com/<blogId>/<logNo>`). If navigation or feedback is ambiguous, inspect the blog or newest-post list before any retry.
5. For an explicitly requested update, open the existing numeric post's update form, replace the title/body/images in that post, save once, and verify the same numeric public URL. Never create a replacement post unless the user asks for one.

## Proof of completion

Do not call a post published from a local response or button click alone. Require a numeric public URL such as `https://blog.naver.com/<blogId>/<logNo>`, then verify the public or mobile page:

- responds successfully;
- contains the intended title and representative body text;
- exposes the expected number of Naver `se-image` components.

Report the public post URL, selected Naver category, verified image count, saved image folder, source links, and any failed attempt that did not publish. State clearly when login, CAPTCHA, two-step verification, unavailable category, or another manual Naver confirmation blocks completion.

## Maintain the published-post archive

After public verification succeeds, create one Markdown file under `references/published-posts/` containing the title, public URL, publication time when available, selected Naver category, topic keys, a concise overlap summary, sources, and the complete published text. Then add a row to `references/published-posts/INDEX.md`.

Archive only publicly verified posts. Update the archive in the same posting run so the next request always sees the latest topic. Use the numeric Naver log number as the filename prefix, followed by a short lowercase topic slug. Do not store login details, cookies, tokens, or local session data.
