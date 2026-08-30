import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
const ALLOWED_LICENSE = /^(?:CC0|CC BY(?:-SA)?(?:\s|$)|Public domain)/i;
const MIME_EXTENSION = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export async function searchCommonsImages(query, { fetchImpl = fetch, limit = 9 } = {}) {
  const cleanQuery = String(query || '').trim();
  if (cleanQuery.length < 2 || cleanQuery.length > 200) throw new Error('이미지 검색어를 2~200자로 입력해주세요.');
  const targetLimit = Math.min(Math.max(Number(limit) || 9, 1), 12);
  for (const searchQuery of buildSearchVariants(cleanQuery)) {
    const params = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: searchQuery, gsrnamespace: '6',
      gsrlimit: String(Math.min(targetLimit * 2, 18)), prop: 'imageinfo',
      iiprop: 'url|extmetadata|mime', iiurlwidth: '1600', format: 'json', origin: '*'
    });
    const response = await fetchImpl(`${COMMONS_API}?${params}`, {
      headers: { 'User-Agent': 'NaverNeighborConsole/0.1 (+local image search)' },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`이미지 검색 오류 (${response.status})`);
    const data = await response.json();
    const images = Object.values(data.query?.pages || {}).map(normalizeCommonsImage).filter(Boolean).slice(0, targetLimit);
    if (images.length) return images;
  }
  return [];
}

export async function fetchSourceArticleImages(sourceUrl, { fetchImpl = fetch } = {}) {
  const cleanUrl = safeUrl(sourceUrl);
  if (!cleanUrl) return [];
  try {
    const response = await fetchImpl(cleanUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return [];
    const html = await response.text();
    const images = [];

    // Extract Open Graph image
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch && ogMatch[1]) {
      const ogUrl = resolveUrl(ogMatch[1], cleanUrl);
      if (ogUrl) {
        images.push({
          id: 'source-og-image',
          title: '트렌드 기사 대표 이미지',
          previewUrl: ogUrl,
          downloadUrl: ogUrl,
          pageUrl: cleanUrl,
          author: '뉴스 출처 대표 이미지',
          license: '기사 출처 이미지',
          licenseUrl: cleanUrl,
          description: '기사 원본 대표 이미지',
          provider: '기사 출처'
        });
      }
    }
    return images;
  } catch {
    return [];
  }
}

export async function searchOpenImages(query, { fetchImpl = fetch, limit = 12, sourceUrl = '' } = {}) {
  const [commons, openverse, sourceImages] = await Promise.allSettled([
    searchCommonsImages(query, { fetchImpl, limit }),
    searchOpenverseImages(query, { fetchImpl, limit }),
    fetchSourceArticleImages(sourceUrl, { fetchImpl })
  ]);
  const combined = [
    ...(sourceImages.status === 'fulfilled' ? sourceImages.value : []),
    ...(openverse.status === 'fulfilled' ? openverse.value : []),
    ...(commons.status === 'fulfilled' ? commons.value : [])
  ];
  const seen = new Set();
  return combined
    .filter((image) => image.downloadUrl && !seen.has(image.downloadUrl) && seen.add(image.downloadUrl))
    .slice(0, Math.min(Math.max(Number(limit) || 12, 1), 18));
}

export async function searchOpenverseImages(query, { fetchImpl = fetch, limit = 12 } = {}) {
  const cleanQuery = String(query || '').trim();
  if (cleanQuery.length < 2 || cleanQuery.length > 200) throw new Error('이미지 검색어를 2~200자로 입력해주세요.');
  for (const searchQuery of buildSearchVariants(cleanQuery)) {
    const params = new URLSearchParams({
      q: searchQuery,
      page_size: String(Math.min(Math.max(Number(limit) || 12, 1), 20)),
      license_type: 'commercial'
    });
    const response = await fetchImpl(`${OPENVERSE_API}?${params}`, {
      headers: { 'User-Agent': 'NaverNeighborConsole/0.1 (+local image search)' },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Openverse 이미지 검색 오류 (${response.status})`);
    const data = await response.json();
    const images = (data.results || []).map(normalizeOpenverseImage).filter(Boolean);
    if (images.length) return images;
  }
  return [];
}

function getImageExtension(bytes, mime = '') {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return '.png';
  if (bytes.slice(0, 3).toString() === 'GIF') return '.gif';
  if (mime.includes('png')) return '.png';
  if (mime.includes('gif')) return '.gif';
  return '.jpg';
}

export async function downloadCommonsImages(images, directory, { fetchImpl = fetch } = {}) {
  const selected = (Array.isArray(images) ? images : []).slice(0, 6).map(validateCommonsImage);
  await mkdir(directory, { recursive: true });
  const downloaded = [];
  for (const image of selected) {
    try {
      const response = await fetchImpl(image.downloadUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) continue;
      const mime = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) continue;
      const extension = getImageExtension(bytes, mime);
      const filePath = path.join(directory, `${randomUUID()}${extension}`);
      await writeFile(filePath, bytes, { mode: 0o600 });
      downloaded.push({ ...image, filePath });
    } catch {
      // Skip failed image
    }
  }
  return downloaded;
}

export async function cleanupDownloadedImages(images = []) {
  await Promise.all(images.map((image) => rm(image.filePath, { force: true }).catch(() => {})));
}

export function appendImageAttributions(content, images = []) {
  if (!images.length) return content;
  if (images.every((image) => image.license === '핫딜 상품 이미지')) {
    return `${String(content).trim()}\n\n이미지 출처 | 각 상품 및 판매 페이지`;
  }
  const lines = images.map((image, index) => {
    const author = image.author || '상품/출처 페이지 참조';
    return `${index + 1}. ${image.title} — ${author} / ${image.license}\n출처: ${image.pageUrl}`;
  });
  return `${String(content).trim()}\n\n이미지 출처 및 라이선스\n${lines.join('\n\n')}`;
}

function normalizeCommonsImage(page) {
  const info = page?.imageinfo?.[0];
  const metadata = info?.extmetadata || {};
  const license = stripHtml(metadata.LicenseShortName?.value);
  const mime = String(info?.mime || '').toLowerCase();
  const downloadUrl = safeUrl(info?.thumburl || info?.url, 'upload.wikimedia.org');
  const pageUrl = safeUrl(info?.descriptionurl, 'commons.wikimedia.org');
  if (!downloadUrl || !pageUrl || !MIME_EXTENSION[mime] || !ALLOWED_LICENSE.test(license)) return null;
  return {
    id: String(page.pageid || ''),
    title: String(page.title || '').replace(/^File:/i, '').trim().slice(0, 200),
    previewUrl: downloadUrl,
    downloadUrl,
    pageUrl,
    author: stripHtml(metadata.Artist?.value || metadata.Credit?.value).slice(0, 300),
    license,
    licenseUrl: safeUrl(metadata.LicenseUrl?.value),
    description: stripHtml(metadata.ImageDescription?.value || metadata.ObjectName?.value).slice(0, 300)
    , searchText: ''
  };
}

function normalizeOpenverseImage(item) {
  const previewUrl = safeUrl(item?.thumbnail, 'api.openverse.org');
  const pageUrl = safeUrl(item?.foreign_landing_url);
  const license = formatOpenverseLicense(item?.license, item?.license_version);
  if (!previewUrl || !pageUrl || !ALLOWED_LICENSE.test(license) || item?.mature === true) return null;
  const tags = (Array.isArray(item.tags) ? item.tags : []).map((tag) => String(tag?.name || '')).filter(Boolean).slice(0, 12);
  return {
    id: String(item.id || ''),
    title: String(item.title || 'Openverse 이미지').trim().slice(0, 200),
    previewUrl,
    downloadUrl: previewUrl,
    pageUrl,
    author: stripHtml(item.creator).slice(0, 300),
    license,
    licenseUrl: safeUrl(item.license_url),
    description: stripHtml(item.meta_data?.description || tags.join(', ')).slice(0, 300),
    searchText: tags.join(' ').slice(0, 500),
    provider: String(item.source || item.provider || 'Openverse').slice(0, 80)
  };
}

function resolveUrl(relativeOrAbsoluteUrl, baseUrl) {
  try {
    return new URL(relativeOrAbsoluteUrl, baseUrl).href;
  } catch {
    return '';
  }
}

function validateCommonsImage(image) {
  const license = String(image?.license || '').trim();
  const downloadUrl = safeTrustedImageUrl(image?.downloadUrl || image?.previewUrl || image?.image);
  const pageUrl = safeTrustedImageUrl(image?.pageUrl || image?.url) || downloadUrl;
  if (!downloadUrl) throw new Error('이미지 주소를 확인할 수 없습니다.');
  return {
    title: String(image.title || '이미지').trim().slice(0, 200),
    downloadUrl,
    pageUrl,
    author: stripHtml(image.author || image.shop || '상품 판매처').slice(0, 300),
    license: license.slice(0, 100) || '핫딜 상품 이미지',
    licenseUrl: safeUrl(image.licenseUrl) || pageUrl,
    afterHeading: String(image.afterHeading || '').trim().slice(0, 2000),
    caption: String(image.caption || '').trim().slice(0, 300)
  };
}

function safeTrustedImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    return '';
  } catch {
    return '';
  }
}

function formatOpenverseLicense(name, version) {
  const normalized = String(name || '').toLowerCase();
  const labels = { cc0: 'CC0', by: 'CC BY', 'by-sa': 'CC BY-SA', pdm: 'Public domain' };
  const label = labels[normalized] || '';
  return [label, String(version || '').trim()].filter(Boolean).join(' ');
}

function safeUrl(value, expectedHost = '') {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || (expectedHost && url.hostname !== expectedHost)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchVariants(query) {
  const words = query.split(/\s+/).filter(Boolean);
  const variants = [query];
  if (words.length > 3) variants.push(words.slice(0, 2).join(' '));
  if (words.length > 2) variants.push(words.slice(-2).join(' '));
  if (words.length > 1) variants.push(words[0]);
  return [...new Set(variants.filter((value) => value.length >= 2))];
}
