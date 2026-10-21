// One reply per visitor comment. Read from Naver's own comment list (m.blog.naver.com/CommentList.naver), where
// every row carries data-info with commentNo, parentCommentNo and mine. The post page hides replies in a folded
// list, so a reply already there looked missing and the same comment was answered again: 2026-10-21 audit of the
// owner's blog, "행복한 수요일 되세요" with five owner replies, "육아중이라 답방 늦었어요" with five.

export function parseCommentInfo(info = '') {
  const get = (key) => (String(info).match(new RegExp(`${key}:'?([^',}]*)`)) || [])[1] || '';
  return { no: get('commentNo'), parent: get('parentCommentNo'), mine: get('mine') === 'true' };
}

// The owner's replies already under a comment, from the rows of the comment list.
export function ownerRepliesTo(rows = [], commentNo = '') {
  const no = String(commentNo || '');
  if (!no) return [];
  return rows.filter((row) => row.mine && String(row.parent) === no && String(row.no) !== no);
}
