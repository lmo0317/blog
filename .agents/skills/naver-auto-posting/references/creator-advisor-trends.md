# Naver Creator Advisor Trend Analysis Guide

This guide details how to leverage Naver Creator Advisor (`https://creator-advisor.naver.com/naver_blog/lmo0317/trends#trend-by-categories`) to automatically extract, analyze, and publish high-traffic, timely blog posts.

---

## 1. Overview & Data Source

Naver Creator Advisor provides real-time and daily trend data across 32 blog categories directly from Naver Search & Blog inflow analytics:
- **URL**: `https://creator-advisor.naver.com/naver_blog/<blogId>/trends#trend-by-categories`
- **Session**: Authenticated via local Naver profile/session (`apps/engagement/.playwright/naver-session.json`).
- **Core API Endpoint**:
  ```http
  GET https://creator-advisor.naver.com/api/v6/trend/category?categories=<cat1,cat2>&contentType=text&date=<YYYY-MM-DD>&hasRankChange=true&interval=day&limit=20&service=naver_blog
  ```
  - **Category Limit**: Naver allows a maximum of **5 categories** per request. The helper script automatically chunks requests.
  - **Metrics**: Query name, current rank, rankChange (e.g. `NEW`, `+12`, `-2`), and search inflow share (`ratio`).

---

## 2. Helper Script: `fetch-creator-trends.js`

Location: `.agents/skills/naver-auto-posting/scripts/fetch-creator-trends.js`

### CLI Usage:
```powershell
# Default categories ('건강·의학', '요리·레시피', '인테리어·DIY', '상품리뷰', '일상·생각', 'IT·컴퓨터')
node .agents/skills/naver-auto-posting/scripts/fetch-creator-trends.js

# Custom categories
node .agents/skills/naver-auto-posting/scripts/fetch-creator-trends.js --categories "건강·의학,요리·레시피,국내여행,맛집"

# Save full JSON report
node .agents/skills/naver-auto-posting/scripts/fetch-creator-trends.js --output "output/trends-report.json"
```

### Automated Intelligence Built In:
1. **Date Auto-Detection**: Extracts the latest processed date from the Creator Advisor UI (fallback: T-1).
2. **Zero Overlap Filter**: Parses `references/published-posts/INDEX.md` and marks keywords already covered as `[기발행]`.
3. **Priority Scoring**: Ranks topics based on:
   - Sudden search surge (`🔥 NEW`, positive `rankChange`);
   - Inflow ratio;
   - Practical reader utility (health knowledge, recipes/handling, cleaning/organizing, life hacks).

---

## 3. Topic Selection Criteria for Trend Posts

When picking a trend topic from the candidate list:
1. **Practical & Evergreen-Friendly Utility**:
   - Prefer topics where readers are searching for concrete solutions, steps, or knowledge (e.g., "무화과 효능 & 세척법", "꽃게 손질법 & 비린내 없이 찌는법", "이불 버리는 방법 - 대형폐기물 스티커 vs 헌옷수거함").
   - Avoid ephemeral gossip, breaking celebrity rumors, or unverified medical/legal claims.
2. **Accurate Category Routing**:
   - `건강`: Nutrition, symptoms, supplements, exercise, sleep, medical guidelines.
   - `생활`: Cooking/recipes, food storage/handling, cleaning, waste disposal, organizing, life hacks.
   - `자동화`: Coding, bot development, productivity workflows, AI tech.
3. **Source Grounding**:
   - Always run `search_web` to obtain authoritative cooking, agricultural, or nutritional facts before drafting.
4. **Search Intent & High-Effort Editorial Crafting**:
   - 단순히 검색어 키워드만 나열하지 않고, 독자가 이 검색어를 입력한 **진짜 심리와 가려운 곳(Search Intent)**을 분석합니다.
   - 3줄 핵심 요약, 흔히 저지르는 실수 TOP 3, 실전 비교표, 독자 빈출 Q&A(FAQ), 전문가 시크릿 팁을 포함하여 **최소 2,200자(공백 제외) 이상의 정성스럽고 밀도 높은 본문**을 완성합니다.
5. **Native Gemini Imagen Visuals**:
   - Generate 3 realistic editorial-style photos via Gemini's `generate_image` tool illustrating preparation, detail, and practical outcome.

