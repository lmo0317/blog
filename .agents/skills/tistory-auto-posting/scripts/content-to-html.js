// Convert a plain-text / light-markdown article into Tistory editor HTML and
// decide where each image goes (right after the heading named in afterHeading).

const BULLET_RE = /^\s*([-*•·])\s+(.*)$/;
const MD_HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BRACKET_HEADING_RE = /^\[([^\]]{2,60})\]$/;
const NUMBERED_HEADING_RE = /^\d{1,2}[.)]\s+\S.{0,48}$/;

export function normalizeHeadingText(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, '')
    .replace(/^[#\s0-9.\[\]■◆●▶★\-:)]+/, '')
    .replace(/[\s\[\]]+/g, '')
    .toLowerCase();
}

export function looksLikeHtml(content) {
  return /^\s*</.test(content) && /<\/(p|h[1-6]|div|ul|ol|figure|blockquote)>/i.test(content);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function isNumberedHeading(line, prevBlank) {
  const trimmed = line.trim();
  // "1. 소제목" on its own after a blank line, not a full sentence.
  return prevBlank && NUMBERED_HEADING_RE.test(trimmed) && !/(다|요|죠|니다)[.!?]?$/.test(trimmed);
}

export function contentToHtml(content, { headingHints = [] } = {}) {
  const source = String(content || '').replace(/\r\n/g, '\n').trim();
  if (looksLikeHtml(source)) return source;

  const hints = new Set(headingHints.map(normalizeHeadingText).filter((h) => h.length >= 2));
  const lines = source.split('\n');
  const out = [];
  let paragraph = [];
  let list = [];
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${quote.map(inline).join('<br>')}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

  let prevBlank = true;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushAll();
      prevBlank = true;
      continue;
    }

    const md = trimmed.match(MD_HEADING_RE);
    const bracket = trimmed.match(BRACKET_HEADING_RE);
    if (md) {
      flushAll();
      const level = md[1].length <= 2 ? 2 : 3;
      out.push(`<h${level}>${inline(md[2].trim())}</h${level}>`);
    } else if (hints.has(normalizeHeadingText(trimmed)) || isNumberedHeading(trimmed, prevBlank)) {
      flushAll();
      out.push(`<h3>${inline(trimmed)}</h3>`);
    } else if (bracket) {
      flushAll();
      out.push(`<h3>${inline(bracket[1].trim())}</h3>`);
    } else if (/^-{3,}$/.test(trimmed)) {
      flushAll();
      out.push('<hr>');
    } else if (trimmed.startsWith('>')) {
      flushParagraph(); flushList();
      quote.push(trimmed.replace(/^>\s?/, ''));
    } else if (BULLET_RE.test(line)) {
      flushParagraph(); flushQuote();
      list.push(line.match(BULLET_RE)[2]);
    } else {
      flushList(); flushQuote();
      paragraph.push(trimmed);
    }
    prevBlank = false;
  }
  flushAll();
  return out.join('\n');
}

// Split HTML into segments; each segment ends right after a heading that has
// images attached. Images whose heading is not found are appended at the end.
export function planSegments(html, images = []) {
  // Explicit placement: <!-- image:N --> puts images[N-1] exactly there.
  const markerRe = /<!--\s*image:(\d+)\s*-->/g;
  if (/<!--\s*image:\d+\s*-->/.test(html)) {
    const segments = [];
    const placed = new Set();
    let cursor = 0;
    for (const m of html.matchAll(markerRe)) {
      const image = images[Number(m[1]) - 1];
      segments.push({ html: html.slice(cursor, m.index), images: image ? [image] : [] });
      if (image) placed.add(image);
      cursor = m.index + m[0].length;
    }
    const unmatched = images.filter((img) => !placed.has(img));
    segments.push({ html: html.slice(cursor), images: unmatched });
    return { segments: segments.filter((s) => s.html.trim() || s.images.length), unmatched };
  }

  const headingRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings = [];
  let match;
  while ((match = headingRe.exec(html))) {
    headings.push({ end: match.index + match[0].length, key: normalizeHeadingText(match[2]) });
  }

  const byHeading = new Map();
  const unmatched = [];
  const used = new Set();
  for (const image of images) {
    const key = normalizeHeadingText(image.afterHeading);
    let index = key.length >= 2 ? headings.findIndex((h, i) => !used.has(i) && h.key === key) : -1;
    if (index === -1 && key.length >= 2) {
      index = headings.findIndex((h, i) => !used.has(i) && (h.key.includes(key) || key.includes(h.key)));
    }
    if (index === -1) {
      unmatched.push(image);
      continue;
    }
    used.add(index);
    byHeading.set(index, [...(byHeading.get(index) || []), image]);
  }

  const segments = [];
  let cursor = 0;
  [...byHeading.keys()].sort((a, b) => a - b).forEach((index) => {
    const end = headings[index].end;
    segments.push({ html: html.slice(cursor, end), images: byHeading.get(index) });
    cursor = end;
  });
  segments.push({ html: html.slice(cursor), images: unmatched });
  return { segments: segments.filter((s) => s.html.trim() || s.images.length), unmatched };
}
