import { fetchLatestPostsFromRss } from './blog-targets.js';

export const RETURN_VISIT_LIMITS = Object.freeze({ likes: 200, comments: 100 });
const RESTRICTION_PATTERN = /자동입력 방지|캡차|보안 문자|보호조치|추가 인증|로그인이 필요/i;

// 답방: visit a commenter's newest post and leave a like and a comment written for that post.
// Results are saved in the engagement history so they count toward the shared daily caps and
// the same post is never visited twice.
export async function returnVisitCommenter({
  blogId,
  bloggerName = '',
  browserSession,
  embeddedLlama,
  historyStore,
  getTodayUsage = async () => ({ likes: 0, comments: 0 }),
  doLike = true,
  doComment = true,
  secret = false,
  tone = 'friendly',
  assessActivity = null,
  fetchLatest = (id) => fetchLatestPostsFromRss(id, { limit: 1 })
}) {
  const skip = (message, extra = {}) => ({ status: 'skipped', message, liked: false, commented: false, ...extra });
  if (!blogId) return skip('블로그 ID가 없어 답방하지 않았습니다.');

  const usage = await getTodayUsage().catch(() => ({}));
  const like = doLike && (Number(usage.likes) || 0) < RETURN_VISIT_LIMITS.likes;
  const comment = doComment && (Number(usage.comments) || 0) < RETURN_VISIT_LIMITS.comments;
  if (!like && !comment) return skip('오늘 공감·댓글 일일 한도에 도달해 답방하지 않았습니다.');

  if (assessActivity) {
    const activity = await assessActivity(blogId).catch(() => null);
    if (activity && ['dormant', 'spam'].includes(activity.grade)) {
      return skip(`활동이 없거나 광고성 블로그라 답방하지 않았습니다. (${activity.reason || activity.grade})`);
    }
  }

  const [latest] = await fetchLatest(blogId);
  if (!latest) return skip('상대 블로그의 최신 글을 불러오지 못했습니다.');
  if (await historyStore.hasEngagedPost(latest.url, '')) return skip('이미 소통한 글이라 건너뛰었습니다.', { postUrl: latest.url });

  const inspection = await browserSession.inspectPostForEngagement(latest.url);
  if (inspection.alreadyCommented) return skip('이미 내 댓글이 있는 글입니다.', { postUrl: latest.url });

  let commentText = '';
  if (comment && inspection.canComment !== false) {
    const recentComments = await historyStore.getRecentComments(30).catch(() => []);
    commentText = await embeddedLlama.generateBlogComment({
      title: inspection.title || latest.title,
      contentSnippet: inspection.snippet || latest.description,
      imageSummary: inspection.firstImage?.alt || '',
      tone,
      recentComments
    }).catch(() => '');
  }

  const result = await browserSession.likeAndCommentPost({
    postUrl: latest.url,
    commentText,
    doLike: like,
    doComment: comment && Boolean(commentText),
    secret
  });

  await historyStore.addRecord({
    blogId,
    bloggerName: bloggerName || latest.bloggerName,
    title: inspection.title || latest.title,
    postUrl: latest.url,
    keyword: '답방',
    liked: Boolean(result.liked),
    commented: Boolean(result.commented),
    commentText: result.commented ? commentText : '',
    contentSnippet: String(inspection.snippet || '').slice(0, 500),
    status: result.liked || result.commented ? 'success' : 'failed',
    statusMessage: result.message || ''
  });

  const restriction = RESTRICTION_PATTERN.test(`${result.likeReason || ''} ${result.commentReason || ''} ${result.message || ''}`);
  return {
    status: result.liked || result.commented ? 'visited' : 'failed',
    message: result.message || '',
    liked: Boolean(result.liked),
    commented: Boolean(result.commented),
    commentText: result.commented ? commentText : '',
    postUrl: latest.url,
    postTitle: inspection.title || latest.title,
    protectionTriggered: restriction
  };
}
