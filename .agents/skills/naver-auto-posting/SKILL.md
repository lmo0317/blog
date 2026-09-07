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

1. **[💡 바쁜 분들을 위한 3줄 핵심 요약]**: 도입부 끝 또는 글 서두에 바쁜 독자를 위해 전체 핵심 결론과 필수 행동 요령을 3줄로 깔끔하게 정리한 박스/문단 제공.
2. **[⚠️ 흔히 저지르는 치명적 실수 TOP 3 / 실패 방지 꿀팁]**: 초보자들이 실제로 가장 많이 실패하는 포인트와 그 이유, 그리고 해결책을 구체적으로 짚어줌 (*"대부분 여기서 실패합니다!", "절대 이렇게 하지 마세요!"*).
3. **[📊 한눈에 쏙 들어오는 비교/체크리스트 요약]**: 상황별 비교(A vs B, 재질별 차이, 전/후 비교)나 단계별 점검 체크리스트를 구조화된 텍스트/표 형태로 제공.
4. **[❓ 독자들이 가장 많이 묻는 실전 Q&A (FAQ 2~3선)]**: 댓글로 자주 물어볼 법한 실전 궁금증(보관 기한, 대체 재료, 주의 대상, 부작용 등)을 사전에 명쾌하게 해소.
5. **[🎁 전문가의 한 끗 차이 살림/건강 꿀팁 (Secret Pro-Tip)]**: 일반인은 잘 모르는 1%의 비법(식초 한 방울, 4분의 법칙, 특정 호흡 주기 등)을 짚어주어 글의 소장 가치를 극대화.

### 4. 인간적인 블로거 페르소나와 친절한 톤앤매너 (Authentic Voice)
- 딱딱한 기사나 매뉴얼 말투를 지양하고, **다정하면서도 전문성 있는 라이프스타일/건강 큐레이터**의 목소리를 유지합니다.
- 중요한 핵심 수치나 키워드는 시각적으로 강조하고, 문단과 문단 사이의 호흡을 부드럽게 이어주는 자연스러운 구어체 전개(*"여기서 잠깐!", "제가 직접 해보면서 발견한 비법은~", "이것만 기억하시면 절반은 성공입니다"*)를 적절히 활용합니다.
- **이미지와 본문의 유기적 결합**: 삽입된 3장의 사진 바로 아래에는 해당 사진을 보며 직관적으로 따라 할 수 있는 친절한 관찰 포인트나 캡션형 조언을 곁들입니다.

### 5. 신뢰성과 안전성 (Authoritative Grounding)
- 건강, 안전, 의약품, 화학 세제 등 전문성이 요구되는 주제는 반드시 질병관리청, 대학병원, 공공 학술자료 등 공신력 있는 출처에 기반하여 작성하고, 개인차에 따른 주의사항 및 의료진 상담 권고 문구를 자연스럽게 포함합니다.
- 최대 10개의 핵심 타겟 태그를 엄선합니다.

## Naver category routing

Classify the finished article by its primary reader purpose before opening the final publish settings:

- Select the exact Naver category `건강` when the article's main purpose is health knowledge or health behavior, including exercise, sleep, blood pressure, oral health, hygiene, medicine safety, symptoms, prevention, nutrition, or medical-care guidance.
- Select the exact Naver category `생활` when the article's main purpose is a practical household or everyday-life tip, including cleaning, organizing, cooking technique, storage, home maintenance, saving time, digital-life tips, or consumer know-how without a health-centered claim.
- Select the exact Naver category `자동화` when the article's main purpose is development, productivity tools, bot creation, local AI setup, scripting, or automation workflows.
- When multiple apply, choose the category that aligns closest with the article's core claim.
- If the user explicitly requests a specific category, follow that choice.

The category must be selected in Naver's final publish settings. A similarly named tag does not count. Confirm the selected category immediately before the final publish click and include it in the completion report.

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
