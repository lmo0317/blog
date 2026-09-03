import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALGUMON_RANK_URL = 'https://www.algumon.com/n/deal/rank';
const PROFILE_DIR = path.join(__dirname, '..', '.playwright', 'algumon-profile');

import { readdir, rm } from 'node:fs/promises';

async function cleanProfileLocks(profileDir) {
  if (!profileDir) return;
  const targetDirs = [profileDir, path.join(profileDir, 'Default')];
  for (const dir of targetDirs) {
    try {
      const files = await readdir(dir);
      for (const f of files) {
        if (f.toLowerCase().includes('lock') || f.toLowerCase().includes('singleton')) {
          await rm(path.join(dir, f), { force: true, recursive: true }).catch(() => {});
        }
      }
    } catch {}
  }
}

let cache = { loadedAt: 0, deals: [] };

export function extractAlgumonDestination(html = '') {
  const source = String(html || '');
  const scriptMatch = source.match(/const\s+destination\s*=\s*("(?:\\.|[^"\\])*")/i);
  if (scriptMatch) {
    try {
      return normalizeExternalUrl(JSON.parse(scriptMatch[1]));
    } catch {}
  }

  const fallbackMatch = source.match(/class=["'][^"']*fallback[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["']/i);
  return normalizeExternalUrl(decodeHtmlEntities(fallbackMatch?.[1] || ''));
}

export async function resolveAlgumonOutboundUrl(outboundUrl, { fetchImpl = fetch } = {}) {
  const cleanUrl = normalizeHttpUrl(outboundUrl);
  if (!cleanUrl) return '';
  try {
    const response = await fetchImpl(cleanUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow'
    });
    if (!response.ok) return '';
    const finalUrl = normalizeExternalUrl(response.url);
    if (finalUrl) return finalUrl;
    return extractAlgumonDestination(await response.text());
  } catch {
    return '';
  }
}

export async function fetchAlgumonRankDeals({ limit = 5, forceRefresh = false, headless } = {}) {
  const cacheAge = Date.now() - cache.loadedAt;
  if (!forceRefresh && cache.deals.length >= limit && cacheAge < 3 * 60 * 1000) {
    return cache.deals.slice(0, limit);
  }

  const isHeadless = typeof headless === 'boolean'
    ? headless
    : String(process.env.ALGUMON_HEADLESS || 'false').toLowerCase() === 'true';

  let context;
  try {
    await cleanProfileLocks(PROFILE_DIR);
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: isHeadless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ],
      viewport: { width: 1280, height: 900 }
    });

    const page = context.pages()[0] || await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto(ALGUMON_RANK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for challenge resolution or deal cards to render
    let reached = false;
    for (let i = 0; i < 15; i++) {
      const url = page.url();
      if (url.includes('/deal/rank') && !url.includes('challenge')) {
        reached = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!reached) {
      await page.waitForTimeout(2000);
    }

    // Wait for card content
    await page.waitForSelector('.deal-card-content, .card-body', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const scrapedDeals = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.deal-card-content, .card-body'));
      const results = [];
      const seen = new Set();

      for (const card of cards) {
        const linkEl = card.querySelector('a[href*="/n/d/"], a[href*="/d/"], a[href*="/deal/"]');
        if (!linkEl) continue;
        const dealIdMatch = linkEl.href.match(/\/(?:deal|d)\/(\d+)/);
        if (!dealIdMatch) continue;
        const dealId = dealIdMatch[1];
        if (seen.has(dealId)) continue;
        seen.add(dealId);

        const lines = card.innerText.split('\n').map(s => s.trim()).filter(Boolean);
        
        // Find best quality deal image
        const imgs = Array.from(card.querySelectorAll('img'));
        const imageUrl = (image) => image?.currentSrc || image?.src || image?.getAttribute('data-src') || image?.getAttribute('data-original') || '';
        let dealImg = imageUrl(imgs.find(i => imageUrl(i).includes('/image-v2/deal/')))
          || imageUrl(imgs.find(i => !imageUrl(i).includes('site-icon') && !imageUrl(i).includes('profile')))
          || '';
        if (dealImg.includes('site-icon')) dealImg = '';
        if (dealImg) dealImg = dealImg.split('?')[0];

        let rank = '';
        let shop = '';
        let source = '';
        let title = '';
        let price = card.querySelector('.deal-price-text, [class*="deal-price"]')?.textContent?.replace(/\s+/g, ' ').trim() || '';
        let shipping = '배송 무료';

        const rankIndex = lines.findIndex(line => /^\d{1,2}$/.test(line));
        if (rankIndex >= 0) {
          rank = lines[rankIndex];
          if (rankIndex > 0) shop = lines[0];
          if (rankIndex > 1) source = lines[1];
          if (lines[rankIndex + 1]) title = lines[rankIndex + 1];
          if (!price && lines[rankIndex + 2] && !/\d+\s*(?:분|시간|일)\s*전/.test(lines[rankIndex + 2])) price = lines[rankIndex + 2];
          
          const shipLine = lines.slice(rankIndex + 2).find(l => l.includes('배송'));
          if (shipLine) shipping = shipLine;
        } else {
          title = lines[0] || '특가 상품';
          if (!price) price = lines.find((line) => /(?:원|\$|€|¥|무료)/.test(line)) || '가격 확인 필요';
        }

        results.push({
          dealId,
          rank: Number(rank) || (results.length + 1),
          shop: shop || '온라인몰',
          source: source || '알구몬',
          title: title.replace(/\s+/g, ' ').trim(),
          price: price.trim(),
          shipping: shipping.trim(),
          image: dealImg,
          outboundUrl: new URL(linkEl.getAttribute('href'), location.href).href,
          algumonUrl: `https://www.algumon.com/n/deal/${dealId}`
        });
      }

      return results;
    });

    if (!scrapedDeals.length) {
      throw new Error('알구몬에서 핫딜 정보를 불러오지 못했습니다.');
    }

    const deals = await Promise.all(scrapedDeals.map(async (deal) => {
      const sourceUrl = await resolveAlgumonOutboundInContext(context, deal.outboundUrl)
        || await resolveAlgumonOutboundUrl(deal.outboundUrl);
      const normalizedSourceUrl = unwrapKnownRedirectUrl(sourceUrl);
      const productUrl = isDirectProductUrl(normalizedSourceUrl)
        ? normalizedSourceUrl
        : (normalizedSourceUrl ? await resolveProductUrlFromSource(context, normalizedSourceUrl, deal.shop) : '');
      return {
        ...deal,
        url: productUrl || normalizedSourceUrl,
        productUrl,
        sourceUrl: normalizedSourceUrl,
        linkType: productUrl ? 'product' : (normalizedSourceUrl ? 'source' : 'unresolved'),
        outboundUrl: undefined
      };
    }));

    cache = { loadedAt: Date.now(), deals };
    return deals.slice(0, limit);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

async function resolveAlgumonOutboundInContext(context, outboundUrl) {
  const cleanUrl = normalizeHttpUrl(outboundUrl);
  if (!cleanUrl) return '';
  const page = await context.newPage();
  try {
    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const current = normalizeExternalUrl(page.url());
      if (current) return current;
      await page.waitForTimeout(250);
    }
    const fallback = await page.locator('.fallback a[href]').first().getAttribute('href').catch(() => '');
    return normalizeExternalUrl(fallback);
  } finally {
    await page.close().catch(() => {});
  }
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function normalizeExternalUrl(value) {
  const url = normalizeHttpUrl(value);
  if (!url) return '';
  try {
    return /(^|\.)algumon\.com$/i.test(new URL(url).hostname) ? '' : url;
  } catch {
    return '';
  }
}

export function unwrapKnownRedirectUrl(value) {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if (/^(?:www\.)?unsafelink\.com$/i.test(url.hostname)) {
      const embedded = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      return normalizeHttpUrl(`${embedded}${url.search}`) || normalized;
    }
    return normalized;
  } catch {
    return '';
  }
}

export function isDirectProductUrl(value) {
  const normalized = unwrapKnownRedirectUrl(value);
  if (!normalized) return false;
  try {
    const host = new URL(normalized).hostname.replace(/^www\./i, '');
    return !/(^|\.)(?:algumon\.com|ppomppu\.co\.kr|arca\.live|quasarzone\.com|coolenjoy\.net|clien\.net|ruliweb\.com|fmkorea\.com|dealbada\.com|eomisae\.co\.kr|cafe\.naver\.com)$/i.test(host);
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

async function resolveProductUrlFromSource(context, sourceUrl, shop) {
  const page = await context.newPage();
  try {
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800);
    const candidates = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((anchor) => ({
      href: anchor.href,
      text: (anchor.innerText || anchor.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      inArticle: Boolean(anchor.closest('article, [class*="article"], [class*="view-content"], [class*="view_content"], [class*="board-content"], [class*="document"]'))
    })));
    let selected = selectProductCandidate(candidates, sourceUrl, shop);
    if (!selected) {
      const response = await fetch(sourceUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow'
      });
      if (response.ok) selected = selectProductCandidate(extractAnchorCandidates(await response.text(), sourceUrl), sourceUrl, shop);
    }
    if (!selected) return '';
    const resolved = await resolveAlgumonOutboundUrl(selected);
    const finalUrl = unwrapKnownRedirectUrl(resolved || selected);
    return isDirectProductUrl(finalUrl) ? finalUrl : '';
  } catch {
    return '';
  } finally {
    await page.close().catch(() => {});
  }
}

function selectProductCandidate(candidates, sourceUrl, shop) {
  let sourceHost = '';
  try { sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch { return ''; }
  const shopKey = String(shop || '').toLowerCase().replace(/\s+/g, '');
  const shopHosts = [
    [/아마존|amazon/, ['amazon.']],
    [/29cm/, ['29cm.', '29cm.onelink.me']],
    [/오늘의집/, ['ohou.se', 'bucketplace.']],
    [/네이버쇼핑|스마트스토어/, ['smartstore.naver.com', 'shopping.naver.com', 'brand.naver.com']],
    [/쿠팡/, ['coupang.com']],
    [/롯데온/, ['lotteon.com']],
    [/g마켓|지마켓/, ['gmarket.co.kr']],
    [/11번가/, ['11st.co.kr']],
    [/옥션/, ['auction.co.kr']],
    [/알리익스프레스|알리/, ['aliexpress.com']]
  ].find(([pattern]) => pattern.test(shopKey))?.[1] || [];
  const blockedHosts = /(?:google|doubleclick|googlesyndication|youtube|facebook|twitter|x\.com|kakao|discord|twitch|schema\.org|w3\.org|cloudflare|adservice)/i;

  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => {
       const href = unwrapKnownRedirectUrl(candidate?.href);
       if (!href) return null;
      const url = new URL(href);
      const host = url.hostname.replace(/^www\./, '');
       if (host === sourceHost || host.endsWith(`.${sourceHost}`) || blockedHosts.test(host) || !isDirectProductUrl(href)) return null;
      if (/\.(?:jpg|jpeg|png|gif|webp|svg)(?:$|\?)/i.test(url.pathname)) return null;
      let score = candidate.inArticle ? 25 : 0;
      if (shopHosts.some((known) => host === known || host.endsWith(known) || host.includes(known))) score += 100;
      if (/구매|상품|바로가기|최저가|딜|shop|buy/i.test(candidate.text || '')) score += 25;
      if (/\/(?:item|product|products|goods|dp)\b|[?&](?:item|product|goods)/i.test(`${url.pathname}${url.search}`)) score += 15;
      return { href, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
     .find((candidate) => candidate.score >= 35)?.href || '';
}

function extractAnchorCandidates(html, baseUrl) {
  const source = String(html || '');
  return [...source.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => {
    let href = '';
    try { href = new URL(decodeHtmlEntities(match[1]), baseUrl).href; } catch {}
    return {
      href,
      text: decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120),
      inArticle: true
    };
  }).filter((candidate) => candidate.href);
}
