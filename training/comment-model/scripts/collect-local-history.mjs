import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const dataRoot = path.resolve(here, '../data');

const historyPaths = [
  path.join(root, 'apps/engagement/.data/engagement-history.json'),
  path.join(root, 'windows/.data/engagement-history.json')
];
const replyPaths = [
  path.join(root, 'apps/engagement/.data/comment-replies.json'),
  path.join(root, 'windows/.data/comment-replies.json')
];

const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
const normalize = (value) => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();

function redact(value, secrets = []) {
  let text = normalize(value)
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, '[PHONE]')
    .replace(/@[A-Za-z0-9_.-]+/g, '[USER]');
  for (const secret of secrets.map(normalize).filter((item) => item.length >= 2)) {
    text = text.split(secret).join('[USER]');
  }
  return text;
}

async function loadRecords(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeJsonl(file, records) {
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  await fs.writeFile(file, body ? `${body}\n` : '', 'utf8');
}

const uniqueBy = (items, keyFn) => [...new Map(items.map((item) => [keyFn(item), item])).values()];

await fs.mkdir(path.join(dataRoot, 'private'), { recursive: true });
await fs.mkdir(path.join(dataRoot, 'reports'), { recursive: true });

const history = (await Promise.all(historyPaths.map(loadRecords))).flat();
const weakComments = uniqueBy(
  history
    .filter((record) => record.commented && normalize(record.commentText) && normalize(record.title))
    .map((record) => ({
      id: `weak-${hash(`${record.blogId}|${record.title}|${record.commentText}`)}`,
      task: 'blog_comment',
      title: redact(record.title, [record.blogId, record.bloggerName]),
      keyword: redact(record.keyword),
      output: redact(record.commentText, [record.blogId, record.bloggerName]),
      source: 'local_engagement_history',
      quality: 'weak_unverified',
      usableForSft: false,
      missing: ['contentSnippet', 'humanApproval']
    })),
  (record) => normalize(`${record.title}|${record.output}`).toLowerCase()
);

const replies = (await Promise.all(replyPaths.map(loadRecords))).flat();
const replyCandidates = uniqueBy(
  replies
    .filter((record) => record.replied && normalize(record.text) && normalize(record.replyText))
    .map((record) => {
      const secrets = [record.authorId, record.authorName, record.myBlogId];
      return {
        id: `reply-${hash(`${record.commentId}|${record.text}|${record.replyText}`)}`,
        task: 'comment_reply',
        postTitle: redact(record.postTitle, secrets),
        inputComment: redact(record.text, secrets),
        output: redact(record.replyText, secrets),
        source: 'local_comment_replies',
        quality: 'review_required',
        usableForSft: false,
        reviewFlags: ['third_party_input', 'verify_naturalness', 'verify_no_personal_data']
      };
    }),
  (record) => normalize(`${record.inputComment}|${record.output}`).toLowerCase()
);

await writeJsonl(path.join(dataRoot, 'private/weak-blog-comments.jsonl'), weakComments);
await writeJsonl(path.join(dataRoot, 'private/reply-review-candidates.jsonl'), replyCandidates);

const report = {
  generatedAt: new Date().toISOString(),
  sourceCounts: {
    engagementHistoryRecords: history.length,
    replyHistoryRecords: replies.length
  },
  collected: {
    weakBlogComments: weakComments.length,
    replyReviewCandidates: replyCandidates.length
  },
  trainingReady: 0,
  warnings: [
    'weakBlogComments have no contentSnippet or human approval',
    'replyReviewCandidates must be manually reviewed before SFT',
    'raw identifiers and URLs are intentionally not exported'
  ]
};

await fs.writeFile(path.join(dataRoot, 'reports/local-collection.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
