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

독자가 글을 읽었을 때 "단순 AI 요약글이나 백과사전이 아니라, 진짜 살림·건강·IT 전문가가 정성을 다해 쓴 글"이라는 신뢰와 감동을 느낄 수 있도록 아래의 고품질 작성 원칙을 반드시 준수합니다.

### 1. 글자 수 및 정보 밀도 (Depth & Substance)
- **분량 기준**: 순수 본문 기준 **2,200 ~ 3,500자 (공백 제외 1,800~2,800자)**. 무의미한 분량 늘리기(패딩)를 엄격히 금지하고 알짜 실무 정보로 촘촘히 채웁니다.
- **[핵심 원칙] 겉핥기식 서술 전면 금지 (Zero Superficial Skimming)**: 여러 주제를 두루뭉술하게 수박 겉핥기식으로 얕게 훑고 지나가는 글은 절대 금지합니다. 하나의 주제를 정했다면 초보자가 글만 보고도 100% 따라 할 수 있을 만큼 **구체적인 실행 절차, 정확한 설정값/프롬프트, 실제 써보았을 때의 속도와 체감, 무료 플랜의 숨겨진 제약, 돌발 상황별 대처법**까지 깊이 있게 파고들어 작성합니다.
- **[필수 준수] 긴 내용의 1, 2, 3 체계적 분할 포스팅 원칙 (Readable 1-2-3 Hierarchy)**:
  - **1) 단일 포스팅 본문 내 1, 2, 3 구조화**: 내용이 방대하거나 단계가 길어질수록 빽빽한 줄글을 절대 쓰지 않으며, 독자가 3초 만에 파악할 수 있도록 **`1. 핵심 개념/단계명`, `2. 세부 실행/단계명`, `3. 실전 꿀팁/주의사항`**과 같이 일목요연하게 1, 2, 3 넘버링으로 나누어 전개합니다.
  - **2) 번호별 심층 불릿 전개**: 각 번호 항목 아래에는 단순 요약이 아니라 `• 구체적 실행 절차`, `• 실전 예시/프롬프트`, `• 놓치기 쉬운 한계와 대처법` 등을 체계적인 불릿과 시원한 줄바꿈으로 배치하여 모바일과 PC 화면 모두에서 스캔하듯 술술 읽히도록 설계합니다.
  - **3) 방대한 대형 주제의 1, 2, 3탄 시리즈 연재**: 한 번의 글에 억지로 구겨 넣기 어려운 방대한 전문 주제의 경우, 겉핥기 압축을 피하고 **`[1탄: 기초 설정/입문]`, `[2탄: 실전 활용/테크닉]`, `[3탄: 고급 응용/트러블슈팅]`**과 같이 1·2·3탄 연재 시리즈로 분할 기획하여 발행합니다.

### 2. [절대 금지] 공장형 판박이 템플릿 증후군 근절 (Zero-Template Syndrome)
글마다 똑같은 구조와 똑같은 상투구를 찍어내는 행위는 "저품질 AI 양산 블로그"로 낙인찍히는 지름길입니다. 다음 규칙을 엄격히 적용합니다:
- **기계적인 브래킷 제목 표기 금지**: `[바쁜 분들을 위한 3줄 핵심 요약]`, `[흔히 저지르는 치명적 실수 TOP 3]`, `[독자들이 가장 많이 묻는 실전 Q&A]`, `[전문가의 한 끗 차이 실무 꿀팁 (Secret Pro-Tip)]` 같은 브래킷 제목을 모든 글에 기계적으로 똑같이 쓰지 않는다. 주제에 어울리는 자연스러운 소제목과 문맥 속 소단락(`💡 30초 핵심 가이드`, `⚠️ 초보자가 놓치기 쉬운 주의사항`, `실전 문제 해결 FAQ` 등)으로 다양하고 유연하게 변형한다.
- **판박이 도입부/마무리 클리셰 전면 금지**:
  - 도입부에서 `"...한 경험 다들 한 번쯤 있으실 겁니다"`, `"...라는 고민 해보셨을 겁니다"` 같은 복붙형 상투구 전면 금지. 생생한 에피소드, 충격적인 발견, 구체적인 현실의 불편함에서 곧바로 시작할 것.
  - 마무리에서 `"기술의 본질은...", "정보가 부족해서..."` 식의 훈화 말씀과 `"오늘 소개해 드린 ~ 가이드가 도움이 되셨기를... 공감과 댓글 부탁드립니다"` 식의 기계적 복붙 엔딩 전면 금지. 진솔한 총평, 독자의 질문을 유도하는 마무리, 다음 실천 팁으로 자연스럽게 끝맺을 것.
- **실제 사용 경험(Hands-on Detail) 필수 포함**:
  - 실제 사용자의 시점에서 "어디에 접속해서 어떤 버튼을 눌러야 하는지", "직접 써보았을 때 어떤 점이 편리했고 어떤 부분은 한계나 주의가 필요한지", "무료 사용 시 크레딧이나 분량 제한을 아끼는 실전 팁" 등 직접 써본 사람만 아는 1%의 디테일을 반드시 담아야 한다.

### 3. 사람이 직접 쓴 블로그 서식 원칙 (마크다운 특수문자 및 어색한 이모지 전면 금지)
네이버 스마트에디터 ONE은 마크다운 문법을 HTML로 자동 렌더링하지 않고 텍스트 그대로 타이핑하므로, 마크다운 특수문자가 노출되면 심각한 AI 티가 나고 독자의 신뢰를 완전히 잃게 됩니다. "진짜 사람이 정성껏 쓴 글"처럼 보이도록 다음 서식 규칙을 100% 강제합니다:

- **제목 해시태그(`###`, `##`, `#`) 절대 금지**: 소제목 앞에 `###` 기호를 절대 쓰지 않는다. `1. 소제목`, `2. 소제목` 또는 `[소제목]` 형태로 깔끔하고 자연스럽게 작성한다.
- **마크다운 표 기호(`| :--- | :--- |`, `|---|`) 절대 금지**: 표 문법은 텍스트 에디터에서 깨진 파이프(|)와 하이픈(-) 찌꺼기로 그대로 출력되어 극도로 난잡해 보인다. 비교나 정리 내용은 `▶ A 모델 / B 모델` 같은 깔끔한 불릿(`•`, `·`, `▶`)과 들여쓰기 문단으로 보기 좋게 정리한다.
- **코드 블록 백틱(```) 남발 금지**: 프롬프트 예시나 가이드는 마크다운 코드 블록(```)으로 감싸지 말고, 큰따옴표나 `[프롬프트 예시]`, 꺾쇠(`-`), 또는 줄바꿈 인용 형태로 자연스럽게 서술한다.
- **과도하고 어색한 이모티콘 전면 배제 (Zero Robotic Emojis)**: 문단이나 소제목마다 `🤖`, `💡`, `⚠️`, `❓`, `🎁`, `✨` 등의 이모지를 기계적으로 붙이는 것은 전형적인 저품질 AI 생성 글의 특징이다. 단정한 기호(`•`, `▶`)를 주로 사용하고, 전체 글에서 감정선에 맞게 최대 1~2개 이내로만 정제한다.
- **인간적인 블로거 페르소나와 유려한 필력**:
  - 딱딱한 기계 번역투나 사전식 정의를 버리고, 필자가 직접 조사하고 실무에서 검증해 본 경험을 독자에게 친절히 이야기하듯 술술 읽히는 유려한 문장 구조를 갖춘다.
  - 모바일과 PC 화면에서 모두 읽기 편하도록 적절한 줄바꿈과 호흡을 유지한다.

### 4. Image creation and placement (Gemini Imagen - 무단 복제/재탕 절대 금지)

1. **Gemini Engine Only**: All images must be generated using Gemini's native `generate_image` tool (Google Imagen engine). Do NOT use GPT, DALL-E, or external image generation APIs.
2. **절대 기존 이미지 복사/재탕 금지 (Strict Zero-Duplicate Rule)**:
   - 이전 포스팅에 사용했던 이미지 파일이나 로컬에 있는 다른 주제의 이미지를 `copyFileSync` 등으로 복사하여 사용하는 행위를 **엄격히 금지**합니다.
   - 모든 글의 3장 이미지는 **해당 글의 본문 내용에 1:1로 맞춘 고유 프롬프트로 새롭게 생성**되어야 하며, 이미지 해시(SHA256)가 다른 글과 절대 중복되지 않아야 합니다.
3. **사실적이고 일상적인 실사 스타일 (Photorealistic & Contextual)**:
   - 뜬구름 잡는 추상적인 사이버펑크 그래픽이나 복잡한 모니터 화면 그래픽을 피합니다.
   - 실제 한국인의 일상 환경(깔끔한 서재, 카페, 오피스 회의실, 거실)에서 기기를 사용하거나, 깨끗하게 정돈된 데스크셋업, 직관적인 시각 자료 느낌의 실사 포토(editorial photo look)로 생성합니다.
   - 텍스트, 알파벳, 로고, 워터마크가 이미지에 들어가지 않도록 프롬프트에 명시합니다.
4. Unless the user requests another count, plan and publish exactly three images for each normal standalone post after the article structure is fixed. Each image must illustrate the exact section beside it, not just the broad topic.
5. Give every image a different exact `afterHeading` value copied from a real body heading. Use three distinct roles: representative scene, concrete detail or preparation, and practical action or completed result.
6. Save accepted images under `D:\work\dev\blog\output\gemini-images\<date>-<topic>\` with ordered descriptive filenames.

## Naver category routing

발행 전 포스팅 목적에 맞춰 정확한 네이버 블로그 카테고리를 분류하여 지정합니다:

- **`IT`**: 모든 인공지능(AI), 생성형 AI, 테크 트렌드, IT 기기, 소프트웨어, 프롬프트 엔지니어링, 디지털 생산성 툴, 코딩 가이드, 로컬 LLM 관련 주제는 **반드시 `IT` 카테고리로 지정**합니다.
- **`건강`**: 질병 증상, 의학 정보, 영양제, 운동, 수면, 위생, 건강 생활 습관 등 건강 지식 관련 주제.
- **`생활`**: 살림 꿀팁, 청소, 정리수납, 식재료 손질 및 레시피, 분리배출, 다이소 등 일상생활 노하우 관련 주제.
- **⚠️ [절대 사용 금지 / 보호 카테고리] `자동화`, `개발`**:
  - `자동화`와 `개발` 카테고리는 블로그 소유자의 자체 프로그램 개발 로그 전용 카테고리입니다.
  - **자동 포스팅 시스템에서는 절대로 `자동화`나 `개발` 카테고리에 글을 발행하거나 건드리지 않아야 합니다.** (모든 AI/테크/자동화 관련 글은 무조건 **`IT`**로 분류)

## Publish or Update through the selected path

Read and follow [references/direct-browser-publishing.md](references/direct-browser-publishing.md) for every live publication.

1. **신규 발행 시**:
   ```powershell
   node .agents/skills/naver-auto-posting/scripts/publish-post.js --title "<title>" --content-file "<path-to-content.txt>" --category "<category>" --tags "<tag1,tag2>" --images-file "<path-to-images.json>"
   ```
2. **기존 글 수정(Update) 시**:
   ```powershell
   node .agents/skills/naver-auto-posting/scripts/publish-post.js --title "<title>" --content-file "<path-to-content.txt>" --category "<category>" --tags "<tag1,tag2>" --images-file "<path-to-images.json>" --update --log-no "<logNo>"
   ```
   - 기존 글 수정은 고유 URL(`https://blog.naver.com/<blogId>/<logNo>`)을 100% 보존하면서 스마트에디터 ONE의 수정 모드(`PostUpdateForm.naver`)에서 제목, 본문, 이미지, 태그, 카테고리를 완벽하게 교체·저장합니다.
3. If authentication is required, pause at the visible login page for the user as described under **Scope and authorization**.
4. Capture the resulting numeric Naver post URL (e.g. `https://blog.naver.com/<blogId>/<logNo>`), and verify that the content and images rendered correctly.
5. Do not flood publish: maintain natural intervals between live publications to protect account health and reader feed quality.

## Proof of completion

Do not call a post published from a local response or button click alone. Require a numeric public URL such as `https://blog.naver.com/<blogId>/<logNo>`, then verify the public or mobile page:

- responds successfully;
- contains the intended title and representative body text;
- exposes the expected number of Naver `se-image` components.

Report the public post URL, selected Naver category, verified image count, saved image folder, source links, and any failed attempt that did not publish. State clearly when login, CAPTCHA, two-step verification, unavailable category, or another manual Naver confirmation blocks completion.

## Maintain the published-post archive

After public verification succeeds, create one Markdown file under `references/published-posts/` containing the title, public URL, publication time when available, selected Naver category, topic keys, a concise overlap summary, sources, and the complete published text. Then add a row to `references/published-posts/INDEX.md`.

Archive only publicly verified posts. Update the archive in the same posting run so the next request always sees the latest topic. Use the numeric Naver log number as the filename prefix, followed by a short lowercase topic slug. Do not store login details, cookies, tokens, or local session data.
