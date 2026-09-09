import fs from 'node:fs';
import path from 'node:path';
import { validateBlogComment } from '../../../apps/engagement/lib/comment-prompt.js';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const queuePath = path.join(root, 'training', 'comment-model', 'data', 'staged', 'reference-review-queue.jsonl');
const reportPath = path.join(root, 'training', 'comment-model', 'data', 'reports', 'reference-review-audit.json');
const rows = fs.readFileSync(queuePath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const reasonCounts = {};
let candidates = 0;
let validCandidates = 0;

for (const row of rows) {
  const context = { title: row.topic, contentSnippet: row.facts.join(' '), imageSummary: '' };
  row.candidateComments = row.candidateComments.map((item) => {
    candidates += 1;
    const validation = validateBlogComment(item.comment, context, []);
    if (validation.ok) validCandidates += 1;
    for (const reason of validation.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    return { comment: item.comment, validation };
  });
}

fs.writeFileSync(queuePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
fs.writeFileSync(reportPath, `${JSON.stringify({
  auditedAt: new Date().toISOString(),
  records: rows.length,
  candidates,
  validCandidates,
  rejectedCandidates: candidates - validCandidates,
  reasonCounts,
  pendingHumanReview: rows.filter((row) => row.reviewStatus === 'pending').length,
  approvedForProductionSft: rows.filter((row) => row.approvedForProductionSft === true).length
}, null, 2)}\n`, 'utf8');
console.log(`Audited ${candidates} candidates: ${validCandidates} valid, ${candidates - validCandidates} rejected.`);
