// Engagement targets beyond keyword search: a pasted ID list, or the people who comment on a
// popular blog. Each target is turned into its newest post through the public blog RSS feed,
// which needs no login and costs one light request instead of a browser page.

const BLOG_ID_PATTERN = /^[a-zA-Z0-9_-]{2,50}$/;
export const MAX_TARGET_IDS = 500;
export const MAX_SEED_BLOGS = 5;

function decodeXml(value = '') {
  return String(value)
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function readTag(xml, tag) {
  return decodeXml(xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] || '');
}

// Accepts blog IDs, blog.naver.com / m.blog.naver.com URLs, or "@id"; returns unique valid IDs.
export function normalizeBlogIdList(input, { limit = MAX_TARGET_IDS, exclude = [] } = {}) {
  const excluded = new Set(exclude.map((id) => String(id || '').toLowerCase()).filter(Boolean));
  const ids = [];
  const seen = new Set();
  for (const raw of String(Array.isArray(input) ? input.join('\n') : input || '').split(/[\s,，;]+/)) {
    let token = raw.trim().replace(/^@/, '');
    if (!token) continue;
    const blogIdParam = token.match(/[?&]blogId=([^&#]+)/i)?.[1];
    if (blogIdParam) {
      token = blogIdParam;
    } else if (/naver\.com/i.test(token)) {
      try {
        const url = new URL(/^https?:\/\//i.test(token) ? token : `https://${token}`);
        token = url.searchParams.get('blogId') || url.pathname.split('/').filter(Boolean)[0] || '';
      } catch {
        token = '';
      }
    }
    const key = token.toLowerCase();
    if (!BLOG_ID_PATTERN.test(token) || seen.has(key) || excluded.has(key)) continue;
    if (/\.naver$/i.test(token) || ['postview', 'postlist', 'myblog'].includes(key)) continue;
    seen.add(key);
    ids.push(token);
    if (ids.length >= limit) break;
  }
  return ids;
}

export function parseBlogRss(xml, blogId) {
  const text = String(xml || '');
  const bloggerName = readTag(text.split('<item>')[0] || '', 'title');
  const items = [];
  for (const block of text.split('<item>').slice(1)) {
    const link = readTag(block, 'link');
    const logNo = link.match(/\/(\d{8,20})(?:[/?#]|$)/)?.[1] || link.match(/[?&]logNo=(\d+)/)?.[1] || '';
    if (!logNo) continue;
    const description = readTag(block, 'description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const pubDate = readTag(block, 'pubDate');
    items.push({
      blogId,
      // <author> holds the blog ID, so the channel (blog) title is the best display name.
      bloggerName: bloggerName || blogId,
      logNo,
      title: readTag(block, 'title'),
      url: `https://blog.naver.com/${blogId}/${logNo}`,
      link: `https://blog.naver.com/${blogId}`,
      description: description.slice(0, 300),
      postdate: pubDate ? new Date(pubDate).toISOString() : ''
    });
  }
  return items;
}

export async function fetchLatestPostsFromRss(blogId, { limit = 1, fetchFn = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!BLOG_ID_PATTERN.test(String(blogId || ''))) return [];
  try {
    const response = await fetchFn(`https://rss.blog.naver.com/${encodeURIComponent(blogId)}.xml`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!response.ok) return [];
    return parseBlogRss(await response.text(), blogId).slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}

function isActiveWithin(post, activeWithinDays) {
  if (!activeWithinDays || !post.postdate) return true;
  const age = Date.now() - new Date(post.postdate).getTime();
  return Number.isFinite(age) && age <= activeWithinDays * 24 * 60 * 60 * 1000;
}

// Resolves each blog ID to its newest post. IDs without a reachable feed or with no recent
// post are reported through onSkip so the job log can say why they were left out.
export async function resolveLatestPosts(blogIds, { activeWithinDays = 0, fetchFn, onSkip = () => {}, shouldStop = () => false, nicknames = {} } = {}) {
  const posts = [];
  for (const blogId of blogIds) {
    if (shouldStop()) break;
    const [latest] = await fetchLatestPostsFromRss(blogId, { limit: 1, fetchFn });
    if (!latest) {
      onSkip(blogId, '최신 글을 불러오지 못함 (RSS 비공개 또는 글 없음)');
      continue;
    }
    if (!isActiveWithin(latest, activeWithinDays)) {
      onSkip(blogId, `최근 ${activeWithinDays}일 안에 쓴 글이 없음`);
      continue;
    }
    posts.push({ ...latest, bloggerName: nicknames[blogId] || latest.bloggerName });
  }
  return posts;
}
