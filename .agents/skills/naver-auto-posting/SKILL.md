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

4. **Proceed to Standard Quality, Images, and Publishing**:
   Search authoritative sources using `search_web`, draft the 1,500–2,500 character article, generate 3 section-matched Gemini Imagen images, publish to the correct category (`건강`, `생활`, etc.), verify the live URL, and archive in `references/published-posts/`.

## Article quality

Write a natural Korean post with:

- a specific, non-clickbait title;
- a short introduction explaining why the topic matters;
- 4–6 descriptive headings rather than generic labels;
- concrete steps, examples, limitations, and a useful closing action;
- only claims supported by the researched sources;
- up to 10 relevant tags;
- no exposed prompts, `imageQuery`, internal metadata, decorative separator spam, or excessive emoji.

For a normal standalone 생활, 건강, or 자동화 post, require 1,500–2,500 Korean characters of body text excluding tags and source URLs. Treat this as a publish gate, not a target that can be satisfied with repetitive padding. Before publication, count the characters and reject or expand any draft below 1,500 characters.

For health, legal, financial, product-safety, or other high-stakes topics, use especially authoritative current sources, qualify claims conservatively, and add an appropriate limitation notice.

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
