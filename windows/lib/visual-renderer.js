import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

let sharedBrowser = null;

export async function getSharedBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }
  sharedBrowser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  return sharedBrowser;
}

export async function closeSharedBrowser() {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {}
    sharedBrowser = null;
  }
}

const THEME_PALETTES = {
  emerald: {
    bgGradient: 'linear-gradient(135deg, #064e3b 0%, #022c22 100%)',
    badgeBg: 'rgba(16, 185, 129, 0.2)',
    badgeBorder: 'rgba(52, 211, 153, 0.4)',
    badgeText: '#34d399',
    accentColor: '#10b981',
    cardBg: 'rgba(255, 255, 255, 0.06)',
    cardBorder: 'rgba(255, 255, 255, 0.12)',
    glowColor: 'rgba(16, 185, 129, 0.15)',
    highlightBg: 'rgba(16, 185, 129, 0.12)',
    highlightBorder: '#10b981'
  },
  indigo: {
    bgGradient: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)',
    badgeBg: 'rgba(99, 102, 241, 0.2)',
    badgeBorder: 'rgba(129, 140, 248, 0.4)',
    badgeText: '#818cf8',
    accentColor: '#6366f1',
    cardBg: 'rgba(255, 255, 255, 0.06)',
    cardBorder: 'rgba(255, 255, 255, 0.12)',
    glowColor: 'rgba(99, 102, 241, 0.18)',
    highlightBg: 'rgba(99, 102, 241, 0.12)',
    highlightBorder: '#6366f1'
  },
  blue: {
    bgGradient: 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)',
    badgeBg: 'rgba(59, 130, 246, 0.2)',
    badgeBorder: 'rgba(96, 165, 250, 0.4)',
    badgeText: '#60a5fa',
    accentColor: '#3b82f6',
    cardBg: 'rgba(255, 255, 255, 0.06)',
    cardBorder: 'rgba(255, 255, 255, 0.12)',
    glowColor: 'rgba(59, 130, 246, 0.18)',
    highlightBg: 'rgba(59, 130, 246, 0.12)',
    highlightBorder: '#3b82f6'
  },
  sunset: {
    bgGradient: 'linear-gradient(135deg, #431407 0%, #1c1917 100%)',
    badgeBg: 'rgba(249, 115, 22, 0.2)',
    badgeBorder: 'rgba(251, 146, 60, 0.4)',
    badgeText: '#fb923c',
    accentColor: '#f97316',
    cardBg: 'rgba(255, 255, 255, 0.06)',
    cardBorder: 'rgba(255, 255, 255, 0.12)',
    glowColor: 'rgba(249, 115, 22, 0.18)',
    highlightBg: 'rgba(249, 115, 22, 0.12)',
    highlightBorder: '#f97316'
  },
  purple: {
    bgGradient: 'linear-gradient(135deg, #3b0764 0%, #0f172a 100%)',
    badgeBg: 'rgba(168, 85, 247, 0.2)',
    badgeBorder: 'rgba(192, 132, 252, 0.4)',
    badgeText: '#c084fc',
    accentColor: '#a855f7',
    cardBg: 'rgba(255, 255, 255, 0.06)',
    cardBorder: 'rgba(255, 255, 255, 0.12)',
    glowColor: 'rgba(168, 85, 247, 0.18)',
    highlightBg: 'rgba(168, 85, 247, 0.12)',
    highlightBorder: '#a855f7'
  },
  rose: {
    bgGradient: 'linear-gradient(135deg, #4c0519 0%, #18181b 100%)',
    badgeBg: 'rgba(244, 63, 94, 0.2)',
    badgeBorder: 'rgba(251, 113, 133, 0.4)',
    badgeText: '#fb7185',
    accentColor: '#f43f5e',
    cardBg: 'rgba(255, 255, 255, 0.06)',
    cardBorder: 'rgba(255, 255, 255, 0.12)',
    glowColor: 'rgba(244, 63, 94, 0.18)',
    highlightBg: 'rgba(244, 63, 94, 0.12)',
    highlightBorder: '#f43f5e'
  }
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

export function generateCardHtml({
  badge = '⚡ Gemma 4 12B AI 인포그래픽',
  title = '블로그 핵심 가이드',
  subtitle = '',
  items = [],
  highlight = '',
  theme = 'indigo'
}) {
  const palette = THEME_PALETTES[theme] || THEME_PALETTES.indigo;
  const safeBadge = escapeHtml(badge || '⚡ Gemma 4 12B AI 요약');
  const safeTitle = escapeHtml(title || '핵심 인사이트 가이드');
  const safeSubtitle = escapeHtml(subtitle || '');
  const safeHighlight = escapeHtml(highlight || '');

  const renderedItems = (items || []).slice(0, 4).map((item, idx) => {
    let itemTitle = '';
    let itemDesc = '';
    if (typeof item === 'object' && item !== null) {
      itemTitle = escapeHtml(item.title || item.heading || item.name || `포인트 ${idx + 1}`);
      itemDesc = escapeHtml(item.desc || item.description || item.body || item.text || '');
    } else {
      const str = String(item || '');
      const parts = str.split(/[:：-]/);
      if (parts.length > 1) {
        itemTitle = escapeHtml(parts[0].trim());
        itemDesc = escapeHtml(parts.slice(1).join(':').trim());
      } else {
        itemTitle = escapeHtml(str);
      }
    }

    return `
      <div class="card-item">
        <div class="item-number">${idx + 1}</div>
        <div class="item-content">
          <div class="item-title">${itemTitle}</div>
          ${itemDesc ? `<div class="item-desc">${itemDesc}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1200px;
      height: 800px;
      background: ${palette.bgGradient};
      font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif;
      color: #ffffff;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 60px 70px;
      position: relative;
      overflow: hidden;
    }

    .glow-1 {
      position: absolute;
      top: -100px;
      right: -80px;
      width: 450px;
      height: 450px;
      background: ${palette.glowColor};
      border-radius: 50%;
      filter: blur(80px);
      pointer-events: none;
    }
    .glow-2 {
      position: absolute;
      bottom: -120px;
      left: -80px;
      width: 400px;
      height: 400px;
      background: ${palette.glowColor};
      border-radius: 50%;
      filter: blur(80px);
      pointer-events: none;
    }

    .grid-overlay {
      position: absolute;
      inset: 0;
      background-image: radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px);
      background-size: 32px 32px;
      opacity: 0.6;
      pointer-events: none;
    }

    .header {
      position: relative;
      z-index: 2;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 18px;
      background: ${palette.badgeBg};
      border: 1px solid ${palette.badgeBorder};
      color: ${palette.badgeText};
      border-radius: 999px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 20px;
    }
    .title {
      font-size: 42px;
      font-weight: 800;
      line-height: 1.25;
      letter-spacing: -0.02em;
      color: #ffffff;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      max-width: 1040px;
      word-break: keep-all;
    }
    .subtitle {
      font-size: 18px;
      color: rgba(255, 255, 255, 0.75);
      margin-top: 10px;
      font-weight: 500;
    }

    .items-container {
      position: relative;
      z-index: 2;
      display: grid;
      grid-template-columns: repeat(${items.length > 2 ? '3' : '2'}, 1fr);
      gap: 20px;
      margin: 30px 0 24px;
    }

    .card-item {
      background: ${palette.cardBg};
      border: 1px solid ${palette.cardBorder};
      border-radius: 18px;
      padding: 24px 22px;
      backdrop-filter: blur(16px);
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    }
    .item-number {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: ${palette.accentColor};
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 800;
    }
    .item-title {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.35;
      color: #ffffff;
      word-break: keep-all;
    }
    .item-desc {
      font-size: 15px;
      line-height: 1.45;
      color: rgba(255, 255, 255, 0.8);
      word-break: keep-all;
    }

    .footer-row {
      position: relative;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      padding-top: 20px;
    }

    .highlight-box {
      display: flex;
      align-items: center;
      gap: 12px;
      background: ${palette.highlightBg};
      border-left: 4px solid ${palette.highlightBorder};
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      color: #f1f5f9;
      max-width: 800px;
    }

    .watermark {
      font-size: 13px;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.45);
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
  </style>
</head>
<body>
  <div class="glow-1"></div>
  <div class="glow-2"></div>
  <div class="grid-overlay"></div>

  <div class="header">
    <div class="badge">${safeBadge}</div>
    <h1 class="title">${safeTitle}</h1>
    ${safeSubtitle ? `<div class="subtitle">${safeSubtitle}</div>` : ''}
  </div>

  <div class="items-container">
    ${renderedItems}
  </div>

  <div class="footer-row">
    ${safeHighlight ? `
      <div class="highlight-box">
        <span>💡</span>
        <span>${safeHighlight}</span>
      </div>
    ` : '<div style="flex:1;"></div>'}
    <div class="watermark">
      <span>⚡ Gemma 4 12B Local AI Studio</span>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export async function renderVisualCardToPng(cardData, outputDir, { filename = '' } = {}) {
  await mkdir(outputDir, { recursive: true });
  const finalFilename = filename || `ai-card-${randomUUID()}.png`;
  const filePath = path.join(outputDir, finalFilename);

  const html = generateCardHtml(cardData);
  const browser = await getSharedBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });

  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: filePath, type: 'png' });
  } finally {
    await page.close().catch(() => {});
  }

  return {
    id: `ai-visual-${randomUUID().slice(0, 8)}`,
    title: cardData.title || 'AI 비주얼 인포그래픽',
    filePath,
    previewUrl: `/generated-images/${finalFilename}`,
    downloadUrl: `/generated-images/${finalFilename}`,
    pageUrl: '',
    author: 'Gemma 4 12B Local AI Engine',
    license: 'Gemma 4 12B AI 직접 생성',
    licenseUrl: '',
    afterHeading: cardData.afterHeading || '',
    caption: cardData.caption || `⚡ Gemma 4 12B AI 요약 인포그래픽: ${cardData.title}`,
    isAiGenerated: true,
    autoSelected: true
  };
}

export async function renderVisualCardsForPost(post, outputDir) {
  const visualCards = [];
  const themes = ['indigo', 'emerald', 'blue', 'purple', 'sunset', 'rose'];

  if (Array.isArray(post.visualCards) && post.visualCards.length > 0) {
    post.visualCards.slice(0, 4).forEach((card, idx) => {
      visualCards.push({
        ...card,
        theme: card.theme || themes[idx % themes.length],
        afterHeading: card.afterHeading || post.sectionHeadings?.[idx] || ''
      });
    });
  } else {
    // 1. Lead/Summary Infographic Card
    if (post.summaryPoints && post.summaryPoints.length > 0) {
      visualCards.push({
        type: 'summary_card',
        badge: '✨ 3줄 핵심 요약 브리핑',
        title: post.title,
        items: post.summaryPoints.map((pt, i) => ({ title: `핵심 요약 ${i + 1}`, desc: pt })),
        highlight: 'Gemma 4 12B가 핵심 내용을 빠르게 정리했습니다.',
        theme: 'indigo',
        afterHeading: post.sectionHeadings?.[0] || ''
      });
    }

    // 2. Main sections cards
    const headings = post.sectionHeadings || [];
    if (headings.length > 1) {
      headings.slice(1, 4).forEach((heading, idx) => {
        visualCards.push({
          type: 'key_takeaway',
          badge: `📌 핵심 가이드 STEP 0${idx + 1}`,
          title: heading.replace(/^[#\s0-9.💪🎯🚀✨🔥💡]+/, '').trim() || heading,
          items: [
            { title: '실전 포인트', desc: '이 섹션의 핵심 권장사항과 실행 가이드' },
            { title: '주의사항', desc: '놓치기 쉬운 주요 체크리스트' },
            { title: '기대 효과', desc: '적용 시 얻을 수 있는 차별화된 결과' }
          ],
          highlight: '성공적인 적용을 위한 꿀팁을 놓치지 마세요.',
          theme: themes[(idx + 1) % themes.length],
          afterHeading: heading
        });
      });
    }
  }

  const renderedImages = [];
  for (const card of visualCards.slice(0, 3)) {
    try {
      const img = await renderVisualCardToPng(card, outputDir);
      renderedImages.push(img);
    } catch (err) {
      console.error('Failed to render AI visual card:', err);
    }
  }

  return renderedImages;
}
