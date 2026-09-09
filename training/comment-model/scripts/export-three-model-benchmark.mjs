import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
const outputDir = process.argv[3];
if (!input || !outputDir) throw new Error('usage: node export-three-model-benchmark.mjs <input.json> <output-dir>');

const report = JSON.parse(fs.readFileSync(input, 'utf8'));
const models = [
  ['gemma4_e2b_base', 'Gemma 4 E2B 원본'],
  ['gemma4_e2b_qlora_v2', 'Gemma 4 E2B QLoRA v2'],
  ['gemma4_12b_q4', 'Gemma 4 12B Q4']
];
const escapeCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const markdown = [
  '# Gemma 4 세 모델 전체 댓글 테스트 결과',
  '',
  `- 실행 시각: ${report.createdAt}`,
  `- 생성 방식: ${report.generation}`,
  `- 테스트 글: ${report.cases.length}건`,
  '- 모든 모델에 동일한 시스템 프롬프트와 동일한 본문 사실을 입력함',
  ''
];

const csvRows = [[
  '번호', '테스트ID', '카테고리', '글 주제', '본문 사실', '기대 행동',
  '모델', '생성 댓글', '행동 판단', 'validator 통과', '자동 점수', '생성 시간(초)', '거절 사유'
]];

report.cases.forEach((test, index) => {
  markdown.push(`## ${index + 1}. ${test.topic}`, '');
  markdown.push(`- 테스트 ID: \`${test.id}\``);
  markdown.push(`- 카테고리: ${test.category}`);
  markdown.push(`- 기대 행동: ${test.expectedAction === 'skip' ? 'SKIP' : '댓글 작성'}`);
  markdown.push('- 본문에서 확인된 사실:');
  if (test.facts.length) test.facts.forEach((fact) => markdown.push(`  - ${fact}`));
  else markdown.push('  - 확인 가능한 구체적 사실 없음');
  markdown.push('', '| 모델 | 실제 생성 댓글 | 행동 판단 | 검증 | 점수 | 시간 |', '|---|---|---:|---:|---:|---:|');
  for (const [key, label] of models) {
    const output = test.outputs[key];
    markdown.push(`| ${label} | ${escapeCell(output.text)} | ${output.actionCorrect ? '정상' : '실패'} | ${output.validation.ok ? '통과' : `실패: ${escapeCell(output.validation.reasons.join(', '))}`} | ${output.score}/10 | ${output.seconds}초 |`);
    csvRows.push([
      index + 1, test.id, test.category, test.topic,
      test.facts.length ? test.facts.join(' / ') : '확인 가능한 구체적 사실 없음',
      test.expectedAction === 'skip' ? 'SKIP' : '댓글 작성', label, output.text,
      output.actionCorrect ? '정상' : '실패', output.validation.ok ? '통과' : '실패',
      output.score, output.seconds, output.validation.reasons.join(', ')
    ]);
  }
  markdown.push('');
});

markdown.push('## 전체 집계', '', '| 모델 | 행동 판단 | validator 통과 | 평균 점수 | 평균 생성 시간 |', '|---|---:|---:|---:|---:|');
for (const [key, label] of models) {
  const summary = report.summary[key];
  markdown.push(`| ${label} | ${summary.actionCorrect}/${summary.cases} | ${summary.validatorPass}/${summary.cases} | ${summary.averageScore}/10 | ${summary.averageSeconds}초 |`);
}
markdown.push('');

fs.mkdirSync(outputDir, { recursive: true });
const mdPath = path.join(outputDir, 'three-model-all-comments.md');
const csvPath = path.join(outputDir, 'three-model-all-comments.csv');
fs.writeFileSync(mdPath, `${markdown.join('\n')}\n`, 'utf8');
fs.writeFileSync(csvPath, `\uFEFF${csvRows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8');
console.log(JSON.stringify({ markdown: mdPath, csv: csvPath, tests: report.cases.length, outputs: csvRows.length - 1 }, null, 2));
