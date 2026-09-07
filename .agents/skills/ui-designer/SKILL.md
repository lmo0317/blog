---
name: ui-designer
description: Elite UI/UX Design system, component standards, aesthetic visual hierarchy, layout verification, and CSS QA checklist for desktop and web applications. Use whenever designing, reviewing, modifying, or creating user interfaces, HTML layouts, CSS stylesheets, cards, forms, modals, buttons, or dashboards.
---

# 🎨 UI/UX Designer Skill & Design System Guidelines

본 스킬은 **이웃메이트 AI 및 모든 블로그 솔루션의 UI/UX 설계 및 프론트엔드 스타일링 시 반드시 준수해야 하는 최고 수준의 디자인 원칙 및 컴포넌트 표준 가이드**입니다.

모든 에이전트는 프론트엔드 UI(HTML/CSS/JS)를 작성하거나 수정할 때 **반드시 본 스킬의 디자인 시스템 및 QA 체크리스트를 통과해야 합니다.**

---

## 🌟 1. 핵심 디자인 철학 (Design Philosophy)

1. **상용 소프트웨어의 신뢰감 (Commercial Trust)**:
   * 개인 토이 프로젝트 같은 촌스러운 기본 HTML 태그(거친 테두리, 어색한 체크박스, 덩그러니 놓인 인풋)를 절대 허용하지 않는다.
   * Linear, Vercel, Apple 스타일의 정갈하고 모던한 카드형 UI와 부드러운 마이크로 인터랙션을 구현한다.
2. **1-Click 극상의 간결함 (Radical Simplicity)**:
   * 복잡한 파라미터나 난해한 개발자 옵션은 과감히 내부 시스템으로 숨기고, 사용자가 직관적으로 목적을 달성할 수 있는 UI를 제공한다.
3. **레이아웃 결함 무관용 원칙 (Zero Broken Layouts)**:
   * 체크박스/라디오 버튼과 텍스트 분리 현상, 폭 100% 인풋 버그, 화면을 압도하는 과도한 빈 공간 등을 사전에 100% 방지한다.

---

## 🎨 2. 디자인 토큰 (Design Tokens)

### 2.1 컬러 시스템 (Color Palette)
* **브랜드 주색 (Primary Brand)**:
  * 네이버 그린: `#03c75a` (Hover: `#00a94f`, Active: `#008f42`, Soft Bg: `#ecfdf5`, Border: `#a7f3d0`)
  * 모던 인디고: `#4f46e5` (Hover: `#4338ca`, Active: `#3730a3`, Soft Bg: `#e0e7ff`, Border: `#c7d2fe`)
* **상태 컬러 (Semantic States)**:
  * **Success (수락/성공)**: Text `#15803d`, Bg `#f0fdf4`, Border `#bbf7d0`, Badge `#dcfce7`
  * **Danger/Spam (거절/위험)**: Text `#dc2626`, Bg `#fef2f2`, Border `#fecaca`, Badge `#fee2e2`
  * **Warning (대기/주의)**: Text `#d97706`, Bg `#fffbeb`, Border `#fde68a`, Badge `#fef3c7`
  * **Info (정보/진행)**: Text `#2563eb`, Bg `#eff6ff`, Border `#bfdbfe`, Badge `#dbeafe`
* **중립 슬레이트 (Neutral Slate)**:
  * 배경: `#f8fafc` (App Surface), `#ffffff` (Card Surface)
  * 테두리: `#e2e8f0` (Default Border), `#cbd5e1` (Stronger Border)
  * 텍스트 위계:
    * Title/Emphasis: `#0f172a` (Slate 900, 700~800 weight)
    * Body Text: `#334155` (Slate 700, 500~600 weight)
    * Muted/Caption: `#64748b` (Slate 500, 400~500 weight)
    * Disabled/Hint: `#94a3b8` (Slate 400)
* **터미널/로그 다크 톤**:
  * 배경: `#0f172a` (Slate 900) 또는 `#1e293b` (Slate 800) - *단순 새까만 #000000이나 탁한 #1e1e1e 지양*
  * 폰트: JetBrains Mono, Fira Code, Consolas 등 선명한 모노스페이스 (`#e2e8f0`)

### 2.2 곡률 및 그림자 (Radius & Shadows)
* **Border Radius**:
  * 배지/칩: `9999px` (Pill shape)
  * 버튼: `10px ~ 12px`
  * 입력창: `10px`
  * 카드: `14px ~ 18px`
  * 모달: `20px`
* **Box Shadows**:
  * Card: `0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)`
  * Elevated Card: `0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)`
  * Modal: `0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)`

---

## 🧩 3. 컴포넌트별 제작 표준 (Component Guidelines)

### 3.1 폼 컨트롤 & 체크박스 (Form Controls & Checkboxes)
> ⚠️ **[치명적 CSS 버그 방지 규칙]**
> `input { width: 100%; }` 같은 전역 CSS는 `<input type="checkbox">`와 `<input type="radio">`를 거대하게 늘려 텍스트를 우측 끝으로 밀어내는 참사를 일으킵니다.
> **반드시 아래와 같이 체크박스를 완벽히 격리 스타일링해야 합니다:**

```css
/* 체크박스 & 라디오 버튼 전역 안전 격리 */
input[type="checkbox"],
input[type="radio"] {
  width: 16px !important;
  height: 16px !important;
  margin: 0 !important;
  padding: 0 !important;
  accent-color: #03c75a !important;
  flex-shrink: 0 !important;
  cursor: pointer !important;
}

/* 모던 토글 카드 옵션 레이아웃 */
.modern-option-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
}
.modern-option-card:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}
.modern-option-card.selected {
  background: #ecfdf5;
  border-color: #a7f3d0;
}
.modern-option-card .option-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.modern-option-card .option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.modern-option-card .option-title {
  font-size: 13px;
  font-weight: 700;
  color: #1e293b;
}
.modern-option-card .option-desc {
  font-size: 11.5px;
  color: #64748b;
}
```

### 3.2 통계 카운터 카드 (Stat Cards)
* 숫자는 시각적으로 가장 먼저 들어와야 하므로 **선명한 20~24px 볼드 폰트**를 적용한다.
* 상단에 상태 아이콘 및 라벨, 하단에 강조된 수치를 배치하고, 상태별 부드러운 틴트 배경을 준다.

```html
<div class="stat-card" style="padding: 12px 16px; border-radius: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; text-align: center;">
  <span style="font-size: 11px; font-weight: 700; color: #166534; display: flex; align-items: center; justify-content: center; gap: 4px;">
    <span>✅</span> 선별 수락
  </span>
  <div style="font-size: 22px; font-weight: 800; color: #15803d; margin-top: 4px;">12</div>
</div>
```

### 3.3 실행 CTA 버튼 (Action Buttons)
* **단조로운 형광색 단색 지양**:
  * 부드러운 그라데이션(`linear-gradient(135deg, #03c75a 0%, #00a94f 100%)`) 또는 세련된 솔리드 컬러.
  * 아이콘과 텍스트의 적절한 간격(`gap: 8px`).
  * Hover 시 자연스러운 승강 효과(`transform: translateY(-1px); box-shadow: 0 6px 20px rgba(3, 199, 90, 0.25);`).

### 3.4 실시간 터미널/로그 (Terminal & Console)
* 답답하게 화면 절반을 가리는 거대 박스를 피하고, **가독성 좋은 컴팩트 높이(180~220px)**를 유지한다.
* 상단에 툴바(로그 복사, 로그 지우기, 상태 인디케이터)를 깔끔하게 일렬 배치한다.
* `[정보]`, `[성공]`, `[스팸 차단]`, `[대기]` 등 로그 태그별 컬러 코딩 적용.

### 3.5 리스트 및 피드 아이템 (Inbox / Request Items)
* 단순히 텍스트만 나열하지 않고, **블로거 프로필 아이콘, 닉네임, 블로그ID, 날짜, 신청 멘트(말풍선 스타일), AI 분석 판정 뱃지**를 카드 안에 단정하게 그룹화한다.
* 거절 권장 신청은 연한 붉은색 뱃지(`[🛡️ 광고/매크로 의심 - 거절 권장]`), 찐이웃 신청은 연한 녹색 뱃지(`[✅ 진성 소통 블로거 - 수락 권장]`)를 명확히 부착한다.

---

## ✅ 4. UI/UX 구현 전/후 QA 체크리스트 (Mandatory Checklist)

코드를 커밋하거나 작업을 완료하기 전에 **반드시 다음 5가지 항목을 자가 검증**해야 합니다:

1. **[정렬 검증]**: 체크박스, 라디오 버튼, 토글 스위치가 텍스트와 분리되거나 가로 100%로 늘어나 찌그러지지 않았는가?
2. **[여백 및 시각적 균형]**: 좌우 컬럼의 높이와 간격이 조화로우며, 불필요하게 거대한 빈 공간이나 너무 빽빽한 요소가 없는가?
3. **[폰트 위계]**: 제목(Bold), 본문(Medium), 부가설명(Regular/Muted)의 크기와 색상 구분이 뚜렷한가?
4. **[컬러 의미론]**: 성공(초록), 경고(주황/노랑), 거절/위험(빨강), 일반(인디고/슬레이트)의 색상 의미가 통일되었는가?
5. **[초보자 친화성]**: 사용자가 매뉴얼 없이 버튼을 보았을 때 무엇을 누르면 어떤 일이 일어나는지 3초 안에 이해할 수 있는가?
